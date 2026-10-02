import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { fetchPlaygroundAssetBlob } from '@/features/playground/api'
import type { StudioRunSummary } from '@/features/playground/lib/session/session-types'
import type { PendingStudioRun } from '@/features/playground/lib/studio/studio-feed'
import { requestStoryboardShots } from '@/features/workbench/engine/canvas-storyboard-ai'
import {
  newStoryboardScene,
  selectStoryboard,
  useCreateStore,
  type StoryboardScene,
} from '@/stores/create-store'
import { usePlaygroundStore } from '@/stores/playground-store'

import { MAX_STORYBOARD_SCENES } from '../constants'
import { blobToDataUrl } from '../lib/media'
import { fetchVideoTask, resolveVideoLastFrame } from '../lib/video-last-frame'
import type { GenerationController } from './use-generation-controller'
import type { UseStudioResult } from './use-studio'

/** Poll interval and patience while a chained scene waits for its predecessor. */
const CHAIN_POLL_MS = 5000
const CHAIN_TIMEOUT_MS = 45 * 60 * 1000

export type SceneProgress = {
  pending: PendingStudioRun[]
  runs: StudioRunSummary[]
}

/** Prompt sent for one shot: the still-frame description, then the motion. */
export function scenePromptFromShot(shot: {
  imageGenerationPrompt: string
  videoMotionPrompt: string
}): string {
  return [shot.imageGenerationPrompt, shot.videoMotionPrompt]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * Storyboard of the active video project: a script split into scenes, each
 * generated as its own video job. Scenes keep the batch id of their latest
 * run, which links them to queued/running jobs and finished results.
 */
export function useStoryboard(input: {
  controller: GenerationController
  studio: UseStudioResult
}) {
  const { t } = useTranslation()
  const { controller, studio } = input
  const sessionId = controller.studioSession?.id ?? null
  const draft = useCreateStore((state) => selectStoryboard(state, sessionId))
  const patchStoryboard = useCreateStore((state) => state.patchStoryboard)
  const setScenesInStore = useCreateStore((state) => state.setScenes)
  const storyboardModel = useCreateStore((state) => state.storyboardModel)
  const group = usePlaygroundStore((state) => state.config.group)
  const [chain, setChain] = useState<{ done: number; total: number } | null>(
    null
  )
  // A chain runs for minutes; it reads the latest runs and jobs through refs
  // and stops when asked or when the workspace unmounts.
  const runsRef = useRef<StudioRunSummary[]>([])
  const pendingRef = useRef<PendingStudioRun[]>([])
  // Each chain owns a token; stopping or unmounting invalidates it.
  const chainToken = useRef(0)
  useEffect(() => {
    runsRef.current = controller.studioSession?.runs ?? []
    pendingRef.current = studio.pendingRuns
  })
  useEffect(
    () => () => {
      chainToken.current += 1
    },
    []
  )

  /** Storyboards belong to a project; the first edit creates one. */
  const ensureSession = (): string | undefined =>
    sessionId ?? controller.ensureSessionId()

  const setScenes = (
    updater: (scenes: StoryboardScene[]) => StoryboardScene[]
  ) => {
    const id = ensureSession()
    if (id) setScenesInStore(id, updater)
  }

  const patch = (value: Parameters<typeof patchStoryboard>[1]) => {
    const id = ensureSession()
    if (id) patchStoryboard(id, value)
  }

  const progress = useMemo(() => {
    const map = new Map<string, SceneProgress>()
    const runs = controller.studioSession?.runs ?? []
    for (const scene of draft.scenes) {
      if (!scene.batchId) continue
      map.set(scene.id, {
        pending: studio.pendingRuns.filter(
          (job) => job.input.batchId === scene.batchId
        ),
        runs: runs.filter((run) => run.batchId === scene.batchId),
      })
    }
    return map
  }, [controller.studioSession?.runs, draft.scenes, studio.pendingRuns])

  const split = useMutation({
    mutationFn: async () => {
      if (!storyboardModel) {
        throw new Error(t('Choose a model to write the storyboard.'))
      }
      return requestStoryboardShots({
        model: storyboardModel,
        group,
        idea: draft.script,
        shotCount: draft.shotCount,
        style: draft.style,
      })
    },
    onSuccess: (shots) => {
      if (shots.length === 0) {
        toast.error(t('The model did not return any scenes. Try again.'))
        return
      }
      setScenes(() =>
        shots.map((shot) => newStoryboardScene(scenePromptFromShot(shot)))
      )
      toast.success(t('{{count}} scenes ready', { count: shots.length }))
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : t('Could not split the script.')
      )
    },
  })

  const frameDataUrl = async (
    scene: StoryboardScene
  ): Promise<string | null> => {
    if (!scene.frame) return null
    if (scene.frame.dataUrl?.startsWith('data:')) return scene.frame.dataUrl
    if (!scene.frame.assetId) return null
    const blob = await fetchPlaygroundAssetBlob(scene.frame.assetId)
    return blobToDataUrl(blob)
  }

  /** Waits for a scene's video, then returns its last frame as a reference. */
  const waitForLastFrame = async (
    batchId: string,
    token: number
  ): Promise<string> => {
    const deadline = Date.now() + CHAIN_TIMEOUT_MS
    while (chainToken.current === token && Date.now() < deadline) {
      const failed = pendingRef.current.some(
        (job) => job.input.batchId === batchId && job.status === 'error'
      )
      if (failed) throw new Error('scene failed')
      const taskId = runsRef.current.find(
        (run) => run.batchId === batchId && run.taskId
      )?.taskId
      if (taskId) {
        const task = await fetchVideoTask(taskId)
        if (task?.status === 'FAILURE') throw new Error('scene failed')
        if (task?.status === 'SUCCESS') return resolveVideoLastFrame({ taskId })
      }
      await new Promise((resolve) => window.setTimeout(resolve, CHAIN_POLL_MS))
    }
    throw new Error('chain stopped')
  }

  /**
   * Chained generation: scene N+1 starts once scene N finished, from its
   * last frame, so the clips cut together. Scenes with their own first
   * frame keep it.
   */
  const generateChained = async (runnable: StoryboardScene[]) => {
    chainToken.current += 1
    const token = chainToken.current
    setChain({ done: 0, total: runnable.length })
    toast.info(
      t('Scenes will start one after another, each from the last frame.')
    )
    let previousBatch: string | null = null
    try {
      for (const [index, scene] of runnable.entries()) {
        let frame = await frameDataUrl(scene)
        if (!frame && previousBatch) {
          frame = await waitForLastFrame(previousBatch, token)
        }
        if (chainToken.current !== token) return
        const batchId = controller.startJobs(
          [scene.prompt.trim()],
          frame ? [frame] : []
        )
        if (!batchId) return
        previousBatch = batchId
        setScenes((current) =>
          current.map((item) =>
            item.id === scene.id ? { ...item, batchId } : item
          )
        )
        setChain({ done: index + 1, total: runnable.length })
      }
    } catch {
      if (chainToken.current === token) {
        toast.error(
          t('The scene chain stopped because a scene could not continue.')
        )
      }
    } finally {
      if (chainToken.current === token) setChain(null)
    }
  }

  /** Queues one video job per scene and remembers each scene's batch. */
  const generate = async (scenes: StoryboardScene[]) => {
    const runnable = scenes.filter((scene) => scene.prompt.trim())
    if (runnable.length === 0) {
      toast.error(t('Add a prompt to at least one scene.'))
      return
    }
    if (chain) {
      toast.info(t('A scene chain is already running.'))
      return
    }
    if (draft.chainScenes && runnable.length > 1) {
      await generateChained(runnable)
      return
    }
    const started = new Map<string, string>()
    for (const scene of runnable) {
      let frame: string | null = null
      try {
        frame = await frameDataUrl(scene)
      } catch {
        toast.error(t('Could not load the first frame of a scene.'))
        continue
      }
      const batchId = controller.startJobs(
        [scene.prompt.trim()],
        frame ? [frame] : []
      )
      // A refusal (sign-in, limits) applies to every scene alike.
      if (!batchId) break
      started.set(scene.id, batchId)
    }
    if (started.size === 0) return
    setScenes((current) =>
      current.map((scene) => {
        const batchId = started.get(scene.id)
        return batchId ? { ...scene, batchId } : scene
      })
    )
  }

  const selected = draft.scenes.filter((scene) => scene.selected)

  return {
    draft,
    progress,
    selected,
    canAddScene: draft.scenes.length < MAX_STORYBOARD_SCENES,
    setScript: (script: string) => patch({ script }),
    setStyle: (style: string) => patch({ style }),
    setShotCount: (shotCount: number) => patch({ shotCount }),
    setChainScenes: (chainScenes: boolean) => patch({ chainScenes }),
    /** Chaining needs a model that accepts a first frame. */
    canChain: Boolean(controller.draft.capabilityQuery.data?.frames),
    chain,
    stopChain: () => {
      chainToken.current += 1
      setChain(null)
    },
    split,
    addScene: () => setScenes((scenes) => [...scenes, newStoryboardScene()]),
    updateScene: (id: string, value: Partial<StoryboardScene>) =>
      setScenes((scenes) =>
        scenes.map((scene) =>
          scene.id === id ? { ...scene, ...value } : scene
        )
      ),
    removeScene: (id: string) =>
      setScenes((scenes) => scenes.filter((scene) => scene.id !== id)),
    moveScene: (id: string, delta: number) =>
      setScenes((scenes) => {
        const index = scenes.findIndex((scene) => scene.id === id)
        const target = index + delta
        if (index < 0 || target < 0 || target >= scenes.length) return scenes
        const next = [...scenes]
        const [moved] = next.splice(index, 1)
        next.splice(target, 0, moved)
        return next
      }),
    setAllSelected: (value: boolean) =>
      setScenes((scenes) =>
        scenes.map((scene) => ({ ...scene, selected: value }))
      ),
    generate,
  }
}

export type Storyboard = ReturnType<typeof useStoryboard>
