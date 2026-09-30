import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  MAX_STUDIO_BATCH_JOBS,
  clampBatchCount,
} from '@/features/playground/lib/studio/batch-plan'
import { studioGenerationLimiters } from '@/features/playground/lib/studio/generation-limiter'
import { usePlaygroundStore } from '@/stores/playground-store'

import { MISSING_MODEL_ERROR } from '../components/nodes/node-shared'
import { buildNodeGenerationContext } from '../engine/canvas-generation-context'
import {
  runCanvasAudioGeneration,
  runCanvasImageGeneration,
  runCanvasVideoGeneration,
  resumeCanvasVideoGeneration,
  type CanvasGenerationSettings,
} from '../engine/canvas-generation-runner'
import { planImageBatchSlots } from '../engine/canvas-image-batch'
import {
  createVideoBatchSiblings,
  planVideoBatch,
} from '../engine/canvas-video-batch'
import { shouldRecoverCanvasVideoTask } from '../engine/canvas-video-recovery'
import { fitNodeSize } from '../engine/canvas-viewport'
import { useCanvasStore } from '../store/canvas-store'
import {
  CanvasNodeType,
  type CanvasNodeData,
  type CanvasNodeMetadata,
} from '../types'

const activeVideoNodeIds = new Set<string>()

export type GenerateNodeOptions = {
  /** Regenerate just this node's own slot of an image batch. */
  singleSlot?: boolean
  /**
   * Prompt to send instead of the node's saved one, e.g. one `{a|b}`
   * expansion, so the node keeps its template for the next run.
   */
  promptOverride?: string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function pickDefinedMetadata(
  source: CanvasNodeMetadata | undefined,
  keys: Array<keyof CanvasNodeMetadata>
): Partial<CanvasNodeMetadata> {
  const result: Partial<CanvasNodeMetadata> = {}
  if (!source) return result
  keys.forEach((key) => {
    const value = source[key]
    if (value !== undefined && value !== null && value !== '') {
      ;(result as Record<string, unknown>)[key] = value
    }
  })
  return result
}

export function resolveGenerationSettings(
  node: CanvasNodeData,
  nodes: CanvasNodeData[],
  presetNodeId?: string
): CanvasGenerationSettings {
  const preset = presetNodeId
    ? nodes.find((item) => item.id === presetNodeId)
    : undefined
  const keys: Array<keyof CanvasNodeMetadata> = [
    'model',
    'size',
    'quality',
    'count',
    'seconds',
    'aspectRatio',
    'resolution',
    'generateAudio',
    'videoReferenceMode',
    'audioVoice',
    'audioFormat',
    'audioSpeed',
    'audioInstructions',
  ]
  // Preset supplies defaults only for fields the node itself does not define.
  const merged = {
    ...pickDefinedMetadata(preset?.metadata, keys),
    ...pickDefinedMetadata(node.metadata, keys),
  }
  const group = usePlaygroundStore.getState().config.group || ''
  return {
    model: typeof merged.model === 'string' ? merged.model : '',
    group,
    size: typeof merged.size === 'string' ? merged.size : undefined,
    quality: typeof merged.quality === 'string' ? merged.quality : undefined,
    count: typeof merged.count === 'number' ? merged.count : undefined,
    seconds: typeof merged.seconds === 'string' ? merged.seconds : undefined,
    aspectRatio: merged.aspectRatio,
    resolution: merged.resolution,
    generateAudio: merged.generateAudio,
    videoReferenceMode: merged.videoReferenceMode,
    audioVoice:
      typeof merged.audioVoice === 'string' ? merged.audioVoice : undefined,
    audioFormat:
      typeof merged.audioFormat === 'string' ? merged.audioFormat : undefined,
    audioSpeed:
      typeof merged.audioSpeed === 'string' ? merged.audioSpeed : undefined,
    audioInstructions:
      typeof merged.audioInstructions === 'string'
        ? merged.audioInstructions
        : undefined,
  }
}

function applyImageSize(
  nodeId: string,
  naturalWidth?: number,
  naturalHeight?: number
) {
  if (!naturalWidth || !naturalHeight) return
  const size = fitNodeSize(naturalWidth, naturalHeight)
  useCanvasStore.getState().updateNode(nodeId, {
    width: size.width,
    height: size.height,
  })
}

function applyImageToNode(
  nodeId: string,
  image: {
    url: string
    assetId?: number
    naturalWidth?: number
    naturalHeight?: number
  },
  extra: Partial<CanvasNodeMetadata> = {},
  options: { resize?: boolean } = {}
) {
  if (options.resize !== false) {
    applyImageSize(nodeId, image.naturalWidth, image.naturalHeight)
  }
  useCanvasStore.getState().updateNodeMetadata(nodeId, {
    content: image.url,
    assetId: image.assetId,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    status: 'success',
    errorDetails: undefined,
    ...extra,
  })
}

export function useCanvasGeneration(options: { enabled?: boolean } = {}): {
  generateNode: (nodeId: string, options?: GenerateNodeOptions) => Promise<void>
  cancelNode: (nodeId: string) => void
  isNodeRunning: (nodeId: string) => boolean
} {
  const { t } = useTranslation()
  const controllersRef = useRef(new Map<string, AbortController>())
  const stoppedObservationIdsRef = useRef(new Set<string>())
  const [runningIds, setRunningIds] = useState<string[]>([])
  const nodes = useCanvasStore((state) => state.nodes)

  const syncRunningIds = useCallback(() => {
    setRunningIds(
      [...controllersRef.current]
        .filter(([, controller]) => !controller.signal.aborted)
        .map(([id]) => id)
    )
  }, [])

  useEffect(() => {
    const controllers = controllersRef.current
    const stoppedObservationIds = stoppedObservationIdsRef.current
    return () => {
      controllers.forEach((controller, nodeId) => {
        controller.abort()
        activeVideoNodeIds.delete(nodeId)
      })
      controllers.clear()
      stoppedObservationIds.clear()
    }
  }, [])

  useEffect(() => {
    if (options.enabled === false) return
    nodes.forEach((node) => {
      if (
        !shouldRecoverCanvasVideoTask(
          node,
          activeVideoNodeIds,
          stoppedObservationIdsRef.current
        )
      ) {
        return
      }
      const taskId = node.metadata?.taskId
      if (!taskId) return

      const controller = new AbortController()
      activeVideoNodeIds.add(node.id)
      controllersRef.current.set(node.id, controller)
      syncRunningIds()
      useCanvasStore.getState().updateNodeMetadata(node.id, {
        status: 'loading',
        errorDetails: undefined,
        taskStatus: 'RUNNING',
      })
      void resumeCanvasVideoGeneration({
        taskId,
        signal: controller.signal,
        onProgress: (progress) => {
          if (
            controller.signal.aborted ||
            controllersRef.current.get(node.id) !== controller
          ) {
            return
          }
          useCanvasStore.getState().updateNodeMetadata(node.id, {
            status: 'loading',
            taskStatus: progress.status,
            taskProgress: progress.percent ?? undefined,
          })
        },
      })
        .then((result) => {
          if (
            controller.signal.aborted ||
            controllersRef.current.get(node.id) !== controller
          ) {
            return
          }
          applyImageSize(node.id, result.naturalWidth, result.naturalHeight)
          useCanvasStore.getState().updateNodeMetadata(node.id, {
            content: result.url,
            assetId: result.assetId,
            naturalWidth: result.naturalWidth,
            naturalHeight: result.naturalHeight,
            taskStatus: 'SUCCESS',
            taskProgress: 100,
            status: 'success',
            errorDetails: undefined,
          })
        })
        .catch((error: unknown) => {
          if (
            isAbortError(error) ||
            controller.signal.aborted ||
            controllersRef.current.get(node.id) !== controller
          ) {
            return
          }
          // Stop this observer after a transport/timeout error, but retain the
          // upstream status so reloading can resume it (FAILURE comes from progress).
          stoppedObservationIdsRef.current.add(node.id)
          useCanvasStore.getState().updateNodeMetadata(node.id, {
            status: 'error',
            errorDetails: errorMessage(error),
          })
        })
        .finally(() => {
          if (controllersRef.current.get(node.id) === controller) {
            activeVideoNodeIds.delete(node.id)
            controllersRef.current.delete(node.id)
            syncRunningIds()
          }
        })
    })
  }, [nodes, options.enabled, syncRunningIds])

  const cancelNode = useCallback(
    (nodeId: string) => {
      const controller = controllersRef.current.get(nodeId)
      if (!controller) return
      controller.abort()
      activeVideoNodeIds.delete(nodeId)
      // Retain ownership until submit settles: an accepted task ID must still
      // be saved after cancellation, unless a newer run has replaced this one.
      stoppedObservationIdsRef.current.add(nodeId)
      syncRunningIds()
      const node = useCanvasStore
        .getState()
        .nodes.find((item) => item.id === nodeId)
      if (node?.type !== CanvasNodeType.Video) {
        // Image/audio requests cannot be recalled; their results are dropped.
        controllersRef.current.delete(nodeId)
        useCanvasStore.getState().updateNodeMetadata(nodeId, {
          status: 'idle',
          errorDetails: undefined,
        })
        return
      }
      useCanvasStore.getState().updateNodeMetadata(nodeId, {
        status: 'idle',
        taskStatus: 'OBSERVATION_STOPPED',
        errorDetails: undefined,
      })
      toast.info(
        t(
          'Stopped watching this video task. It may still be running on the server.'
        )
      )
    },
    [syncRunningIds, t]
  )

  const isNodeRunning = useCallback(
    (nodeId: string) => runningIds.includes(nodeId),
    [runningIds]
  )

  /**
   * Fans an image node out into `count` single-image jobs: the root is slot
   * one, children fill the rest. Placeholders appear at once and each slot
   * resolves on its own through the shared image limiter.
   */
  const runImageBatch = useCallback(
    async (
      root: CanvasNodeData,
      count: number,
      context: { prompt: string; referenceImages: string[] },
      settings: CanvasGenerationSettings,
      controller: AbortController
    ) => {
      const store = useCanvasStore.getState()
      const plan = planImageBatchSlots(root, store.nodes, count)
      if (plan.removeIds.length) store.removeNodes(plan.removeIds)
      if (plan.created.length) store.insertNodes(plan.created)
      const childIds = [
        ...plan.reuseIds,
        ...plan.created.map((child) => child.id),
      ]
      store.updateNodeMetadata(root.id, {
        isBatchRoot: true,
        primaryImageId: root.id,
        batchChildIds: childIds,
        imageBatchExpanded: root.metadata?.imageBatchExpanded ?? false,
      })
      for (const childId of plan.reuseIds) {
        store.updateNodeMetadata(childId, {
          status: 'loading',
          errorDetails: undefined,
          prompt: root.metadata?.prompt,
          model: root.metadata?.model,
          size: root.metadata?.size,
          quality: root.metadata?.quality,
        })
      }
      const slotIds = [root.id, ...childIds]
      await Promise.all(
        slotIds.map((slotId) =>
          studioGenerationLimiters.image.schedule(async () => {
            if (controller.signal.aborted) return
            try {
              const result = await runCanvasImageGeneration({
                prompt: context.prompt,
                referenceImages: context.referenceImages,
                settings: { ...settings, count: 1 },
              })
              if (controller.signal.aborted) return
              const image = result.images[0]
              if (!image) throw new Error('No images were generated')
              applyImageToNode(slotId, image, {}, { resize: false })
            } catch (error) {
              if (controller.signal.aborted) return
              useCanvasStore.getState().updateNodeMetadata(slotId, {
                status: 'error',
                errorDetails: errorMessage(error),
              })
            }
          })
        )
      )
      if (!controller.signal.aborted) return
      const latest = useCanvasStore.getState()
      for (const slotId of slotIds) {
        const slot = latest.nodes.find((item) => item.id === slotId)
        if (slot?.metadata?.status === 'loading') {
          latest.updateNodeMetadata(slotId, { status: 'idle' })
        }
      }
    },
    []
  )

  const generateSingleNode = useCallback(
    async (nodeId: string, generateOptions: GenerateNodeOptions = {}) => {
      if (options.enabled === false) return
      const store = useCanvasStore.getState()
      const node = store.nodes.find((item) => item.id === nodeId)
      if (!node) return
      if (node.metadata?.status === 'loading') return
      if (
        node.type !== CanvasNodeType.Image &&
        node.type !== CanvasNodeType.Video &&
        node.type !== CanvasNodeType.Audio
      ) {
        return
      }

      const existing = controllersRef.current.get(nodeId)
      // An image batch keeps its root controller until every slot settles,
      // even after the root's own image lands; a second click must not abort
      // the in-flight (already billed) slots. Cancel stays explicit.
      if (existing && node.type === CanvasNodeType.Image) return
      if (existing) existing.abort()
      stoppedObservationIdsRef.current.delete(nodeId)

      const controller = new AbortController()
      if (node.type === CanvasNodeType.Video) activeVideoNodeIds.add(nodeId)
      controllersRef.current.set(nodeId, controller)
      syncRunningIds()

      // Image batch children have no inputs of their own: a slot regenerates
      // from the root's prompt, references and preset.
      const batchRoot =
        node.type === CanvasNodeType.Image && node.metadata?.batchRootId
          ? store.nodes.find((item) => item.id === node.metadata?.batchRootId)
          : undefined
      // References and preset come from the root; the child's own prompt and
      // settings win when the user edited them on the expanded child.
      const source = batchRoot ?? node
      let promptText = source.metadata?.prompt ?? ''
      if (node.metadata?.prompt?.trim()) promptText = node.metadata.prompt
      if (generateOptions.promptOverride != null) {
        promptText = generateOptions.promptOverride
      }
      const context = buildNodeGenerationContext(
        source.id,
        store.nodes,
        store.connections,
        promptText
      )
      const settings = resolveGenerationSettings(
        node,
        store.nodes,
        context.presetNodeId
      )

      if (!settings.model) {
        store.updateNodeMetadata(nodeId, {
          status: 'error',
          errorDetails: MISSING_MODEL_ERROR,
        })
        controllersRef.current.delete(nodeId)
        activeVideoNodeIds.delete(nodeId)
        syncRunningIds()
        return
      }

      store.updateNodeMetadata(nodeId, {
        status: 'loading',
        errorDetails: undefined,
        taskStatus: undefined,
        taskProgress: undefined,
        taskId: undefined,
      })

      try {
        if (node.type === CanvasNodeType.Image) {
          const count =
            batchRoot || generateOptions.singleSlot
              ? 1
              : clampBatchCount(settings.count ?? 1)
          if (count > 1) {
            await runImageBatch(node, count, context, settings, controller)
            return
          }
          const result = await studioGenerationLimiters.image.schedule(() =>
            runCanvasImageGeneration({
              prompt: context.prompt,
              referenceImages: context.referenceImages,
              settings: { ...settings, count: 1 },
            })
          )
          if (controller.signal.aborted) {
            const abortError = new Error('Aborted')
            abortError.name = 'AbortError'
            throw abortError
          }
          const image = result.images[0]
          if (!image) {
            throw new Error('No images were generated')
          }
          if (batchRoot || generateOptions.singleSlot) {
            // One slot of a batch: keep the grid geometry and batch links.
            applyImageToNode(nodeId, image, {}, { resize: false })
            return
          }
          const staleChildren = node.metadata?.batchChildIds ?? []
          if (staleChildren.length) {
            useCanvasStore.getState().removeNodes(staleChildren)
          }
          applyImageToNode(nodeId, image, {
            isBatchRoot: undefined,
            batchChildIds: undefined,
            primaryImageId: undefined,
            imageBatchExpanded: undefined,
          })
          return
        }

        if (node.type === CanvasNodeType.Video) {
          const result = await runCanvasVideoGeneration({
            // Submissions share the studio's video budget; polling does not
            // hold a slot, so a long render never blocks the next submit.
            schedule: studioGenerationLimiters.video.schedule,
            prompt: context.prompt,
            referenceImages: context.referenceImages,
            disableLastFrame: node.metadata?.disableLastFrame,
            settings,
            signal: controller.signal,
            onProgress: (progress) => {
              if (controllersRef.current.get(nodeId) !== controller) return
              if (controller.signal.aborted) {
                useCanvasStore.getState().updateNodeMetadata(nodeId, {
                  taskId: progress.taskId,
                })
                return
              }
              useCanvasStore.getState().updateNodeMetadata(nodeId, {
                taskId: progress.taskId,
                taskStatus: progress.status,
                taskProgress:
                  progress.percent === null ? undefined : progress.percent,
                status: 'loading',
              })
            },
          })
          if (
            controller.signal.aborted ||
            controllersRef.current.get(nodeId) !== controller
          ) {
            return
          }
          applyImageSize(nodeId, result.naturalWidth, result.naturalHeight)
          useCanvasStore.getState().updateNodeMetadata(nodeId, {
            content: result.url,
            assetId: result.assetId,
            naturalWidth: result.naturalWidth,
            naturalHeight: result.naturalHeight,
            taskId: result.taskId,
            taskStatus: 'SUCCESS',
            taskProgress: 100,
            status: 'success',
            errorDetails: undefined,
          })
          return
        }

        const audioText = context.prompt || node.metadata?.content || ''
        const result = await runCanvasAudioGeneration({
          text: audioText,
          settings,
        })
        if (controller.signal.aborted) {
          const abortError = new Error('Aborted')
          abortError.name = 'AbortError'
          throw abortError
        }
        useCanvasStore.getState().updateNodeMetadata(nodeId, {
          content: result.url,
          assetId: result.assetId,
          status: 'success',
          errorDetails: undefined,
        })
      } catch (error) {
        if (controllersRef.current.get(nodeId) !== controller) return
        if (isAbortError(error) || controller.signal.aborted) {
          useCanvasStore.getState().updateNodeMetadata(nodeId, {
            status: 'idle',
            errorDetails: undefined,
          })
          return
        }
        if (node.type === CanvasNodeType.Video) {
          stoppedObservationIdsRef.current.add(nodeId)
        }
        useCanvasStore.getState().updateNodeMetadata(nodeId, {
          status: 'error',
          errorDetails: errorMessage(error),
        })
      } finally {
        if (controllersRef.current.get(nodeId) === controller) {
          if (node.type === CanvasNodeType.Video) {
            activeVideoNodeIds.delete(nodeId)
          }
          controllersRef.current.delete(nodeId)
          syncRunningIds()
        }
      }
    },
    [options.enabled, runImageBatch, syncRunningIds]
  )

  const generateNode = useCallback(
    async (nodeId: string, generateOptions: GenerateNodeOptions = {}) => {
      if (options.enabled === false) return
      const store = useCanvasStore.getState()
      const node = store.nodes.find((item) => item.id === nodeId)
      if (!node) return
      if (node.type !== CanvasNodeType.Video) {
        await generateSingleNode(nodeId, generateOptions)
        return
      }
      if (node.metadata?.status === 'loading') return

      const plan = planVideoBatch(node)
      if (plan.truncated > 0) {
        toast.warning(
          t('Batch limited to {{max}} results; {{count}} were skipped.', {
            max: MAX_STUDIO_BATCH_JOBS,
            count: plan.truncated,
          })
        )
      }
      const batchMode = Boolean(node.metadata?.videoBatchMode)
      if (plan.prompts.length === 1) {
        if (batchMode) {
          store.updateNodeMetadata(nodeId, { prompt: plan.prompts[0] })
          await generateSingleNode(nodeId)
          return
        }
        await generateSingleNode(nodeId, { promptOverride: plan.prompts[0] })
        return
      }

      const batch = createVideoBatchSiblings(
        node,
        plan.prompts,
        store.connections
      )
      // Batch mode reads prompts from `videoBatchPrompts`, so the root's
      // `prompt` field is free to hold its own job; a `{a|b}` template in the
      // single prompt box is kept intact and sent as an override instead.
      store.updateNodeMetadata(nodeId, {
        ...(batchMode ? { prompt: plan.prompts[0] } : {}),
        isBatchRoot: true,
        batchChildIds: batch.nodes.map((child) => child.id),
      })
      store.insertNodes(batch.nodes, batch.connections)
      await Promise.all([
        generateSingleNode(
          nodeId,
          batchMode ? {} : { promptOverride: plan.prompts[0] }
        ),
        ...batch.nodes.map((child) => generateSingleNode(child.id)),
      ])
    },
    [generateSingleNode, options.enabled, t]
  )

  return { generateNode, cancelNode, isNodeRunning }
}
