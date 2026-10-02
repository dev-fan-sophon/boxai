import { useQueryClient } from '@tanstack/react-query'
import { nanoid } from 'nanoid'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  createPlaygroundRun,
  generateImages,
  generateSpeech,
  getVideoCapabilities,
  submitVideo,
} from '@/features/playground/api'
import {
  ensureActiveStudioProjectId,
  recordActiveStudioRun,
} from '@/features/playground/hooks/use-session-cloud-sync'
import {
  getVideoCapabilityMode,
  type VideoCapabilities,
} from '@/features/playground/hooks/use-video-capabilities'
import {
  generatedMediaExtension,
  persistGeneratedMediaAsset,
} from '@/features/playground/lib/download-generated-media'
import type { StudioRunSummary } from '@/features/playground/lib/session/session-types'
import { studioGenerationLimiters } from '@/features/playground/lib/studio/generation-limiter'
import {
  createLocalRunId,
  type PendingStudioRun,
  type StudioGenerationInput,
} from '@/features/playground/lib/studio/studio-feed'
import { buildPlaygroundVideoSubmitInput } from '@/features/playground/lib/studio/video-submit'
import type { StudioSettings } from '@/features/playground/types'
import { usePlaygroundStore } from '@/stores/playground-store'

import {
  alignAudio,
  changeVoice,
  composeMusic,
  generateSoundEffect,
  isolateAudio,
  synthesizeSpeech,
  transcribeAudio,
} from '../lib/audio-api'
import { resolveAudioInput } from '../lib/audio-inputs'
import { encodeTranscript, transcriptFromElevenLabs } from '../lib/transcript'

/**
 * Batch generation engine for the studio modalities. A submit becomes a batch
 * of single-output jobs that share a batch id; each job waits for a slot in
 * the per-modality limiter, runs, and finalizes into the owning session's run
 * history, so results stream into one feed card as they finish. Failed jobs
 * stay on the card with a retry; queued jobs can be cancelled.
 */
export type UseStudioResult = ReturnType<typeof useStudio>

export type StudioBatchRequest = Omit<
  StudioGenerationInput,
  'prompt' | 'batchId'
> & {
  /** One prompt per job, already expanded by `planGenerationJobs`. */
  prompts: string[]
}

export function useStudio() {
  const queryClient = useQueryClient()
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const setSettings = usePlaygroundStore((state) => state.setStudioSettings)
  const [pendingRuns, setPendingRuns] = useState<PendingStudioRun[]>([])
  const pendingRef = useRef<PendingStudioRun[]>([])
  const cancelledRef = useRef(new Set<string>())
  const blobUrlsRef = useRef<string[]>([])
  const unmountedRef = useRef(false)

  // Leaving the playground drops every job still waiting for a slot — the
  // user can no longer see or cancel them, so they must not start (and bill)
  // later. Jobs already running finish and land in the session history.
  useEffect(() => {
    unmountedRef.current = false
    const cancelled = cancelledRef.current
    return () => {
      unmountedRef.current = true
      for (const entry of pendingRef.current) {
        if (entry.status === 'queued') cancelled.add(entry.clientId)
      }
      for (const url of blobUrlsRef.current) URL.revokeObjectURL(url)
      blobUrlsRef.current = []
    }
  }, [])

  const updatePending = useCallback(
    (updater: (previous: PendingStudioRun[]) => PendingStudioRun[]) => {
      pendingRef.current = updater(pendingRef.current)
      setPendingRuns(pendingRef.current)
    },
    []
  )

  const patchPending = useCallback(
    (clientId: string, patch: Partial<PendingStudioRun>) => {
      updatePending((previous) =>
        previous.map((entry) =>
          entry.clientId === clientId ? { ...entry, ...patch } : entry
        )
      )
    },
    [updatePending]
  )

  const removePending = useCallback(
    (clientIds: string[]) => {
      const ids = new Set(clientIds)
      updatePending((previous) =>
        previous.filter((entry) => !ids.has(entry.clientId))
      )
    },
    [updatePending]
  )

  const finalizeRun = useCallback(
    async (input: {
      generation: StudioGenerationInput
      assetId?: number
      taskId?: string
      fallbackUrl?: string
      projectId: number
    }) => {
      const { generation } = input
      const cloudRun = await createPlaygroundRun({
        modality: generation.modality,
        model: generation.model,
        prompt: generation.prompt,
        asset_id: input.assetId,
        task_id: input.taskId,
        batch_id: generation.batchId,
        project_id: input.projectId || undefined,
        result_url: /^https?:\/\//i.test(input.fallbackUrl ?? '')
          ? input.fallbackUrl
          : undefined,
      })
      const run: StudioRunSummary = cloudRun
        ? {
            id: cloudRun.id,
            model: cloudRun.model,
            prompt: cloudRun.prompt,
            resultUrl: cloudRun.result_url || input.fallbackUrl,
            assetId: cloudRun.asset_id,
            taskId: cloudRun.task_id,
            batchId: generation.batchId,
            createdAt: cloudRun.created_at
              ? cloudRun.created_at * 1000
              : Date.now(),
          }
        : {
            id: createLocalRunId(),
            model: generation.model,
            prompt: generation.prompt,
            resultUrl: input.fallbackUrl,
            assetId: input.assetId,
            taskId: input.taskId,
            batchId: generation.batchId,
            createdAt: Date.now(),
          }
      const previewUrl = run.resultUrl
      recordActiveStudioRun({
        sessionId: generation.sessionId,
        prompt: generation.prompt,
        model: generation.model,
        previewUrls:
          previewUrl &&
          !previewUrl.startsWith('data:') &&
          !previewUrl.startsWith('blob:')
            ? [previewUrl]
            : undefined,
        run,
      })
    },
    []
  )

  const executeImageRun = useCallback(
    async (generation: StudioGenerationInput, snapshot: StudioSettings) => {
      const generated = await generateImages({
        model: generation.model,
        group: generation.group,
        prompt: generation.prompt,
        // Every job is one image; the batch supplies the count.
        settings: { ...snapshot, imageCount: 1 },
        referenceImage: generation.references[0] ?? null,
        referenceImages: generation.references.slice(1),
        editMode: generation.references.length > 0,
      })
      if (generated.length === 0) {
        throw new Error('The model returned no images.')
      }
      const projectId = await ensureActiveStudioProjectId(generation.sessionId)
      for (const [index, image] of generated.entries()) {
        // Providers return base64 or short-lived URLs; archiving the bytes as
        // a private asset keeps the result in history after a reload.
        let assetId = image.assetId
        if (!assetId) {
          try {
            const asset = await persistGeneratedMediaAsset(
              image.url,
              `studio-image-${Date.now()}-${index}.png`,
              'image'
            )
            assetId = asset.id
          } catch {
            // The in-tab URL still renders; history falls back to it.
          }
        }
        await finalizeRun({
          generation,
          assetId,
          fallbackUrl: image.url,
          projectId,
        })
      }
      await queryClient.invalidateQueries({ queryKey: ['playground', 'runs'] })
    },
    [finalizeRun, queryClient]
  )

  const executeVideoRun = useCallback(
    async (generation: StudioGenerationInput, snapshot: StudioSettings) => {
      const profiles: VideoCapabilities = await getVideoCapabilities(
        generation.group,
        generation.model
      )
      const mode = getVideoCapabilityMode(
        generation.references.length > 0,
        snapshot.videoReferenceMode
      )
      const capabilities = profiles[mode]
      if (!capabilities) {
        throw new Error(
          'This video mode is unavailable for the selected model.'
        )
      }
      const submission = await submitVideo(
        buildPlaygroundVideoSubmitInput({
          model: generation.model,
          group: generation.group,
          prompt: generation.prompt,
          settings: snapshot,
          references: generation.references,
          capabilities,
        })
      )
      if (!submission.taskId) {
        throw new Error('The provider did not return a task id.')
      }
      const projectId = await ensureActiveStudioProjectId(generation.sessionId)
      await finalizeRun({ generation, taskId: submission.taskId, projectId })
      await queryClient.invalidateQueries({
        queryKey: ['playground', 'task-history'],
      })
      await queryClient.invalidateQueries({ queryKey: ['playground', 'runs'] })
    },
    [finalizeRun, queryClient]
  )

  /**
   * One audio job, routed by the sub-tool resolved at submit. Transcripts
   * are stored as the run text; every audio output is archived as a private
   * playground asset so the run keeps a durable URL after a reload.
   */
  const executeAudioRun = useCallback(
    async (generation: StudioGenerationInput, snapshot: StudioSettings) => {
      const audio = generation.audio ?? { tool: 'speech', native: false }
      const call = { model: generation.model, group: generation.group }
      const inputUrl = generation.references[0]

      if (audio.tool === 'transcribe' || audio.tool === 'align') {
        if (!inputUrl) throw new Error('Attach an audio or video file.')
        const file = await resolveAudioInput(inputUrl)
        const response =
          audio.tool === 'align'
            ? await alignAudio({ ...call, file, text: generation.prompt })
            : await transcribeAudio({ ...call, file, settings: snapshot })
        const transcript = transcriptFromElevenLabs(response, file.name)
        if (transcript.segments.length === 0) {
          throw new Error('No speech was detected in this file.')
        }
        const projectId = await ensureActiveStudioProjectId(
          generation.sessionId
        )
        await finalizeRun({
          generation: { ...generation, prompt: encodeTranscript(transcript) },
          projectId,
        })
        await queryClient.invalidateQueries({
          queryKey: ['playground', 'runs'],
        })
        return
      }

      let blob: Blob
      if (!audio.native) {
        blob = await generateSpeech({
          ...call,
          text: generation.prompt,
          settings: snapshot,
        })
      } else if (audio.tool === 'sfx') {
        blob = await generateSoundEffect({
          ...call,
          text: generation.prompt,
          settings: snapshot,
        })
      } else if (audio.tool === 'music') {
        blob = await composeMusic({
          ...call,
          prompt: generation.prompt,
          settings: snapshot,
        })
      } else if (audio.tool === 'voice-changer' || audio.tool === 'isolate') {
        if (!inputUrl) throw new Error('Attach an audio or video file.')
        const file = await resolveAudioInput(inputUrl)
        blob =
          audio.tool === 'isolate'
            ? await isolateAudio({ ...call, file })
            : await changeVoice({ ...call, file, settings: snapshot })
      } else {
        blob = await synthesizeSpeech({
          ...call,
          text: generation.prompt,
          settings: snapshot,
        })
      }
      if (blob.size === 0) throw new Error('The provider returned no audio.')

      const resultUrl = URL.createObjectURL(blob)
      if (unmountedRef.current) {
        URL.revokeObjectURL(resultUrl)
        return
      }
      blobUrlsRef.current.push(resultUrl)
      let assetId: number | undefined
      try {
        const extension = generatedMediaExtension(blob.type, 'audio')
        const asset = await persistGeneratedMediaAsset(
          resultUrl,
          `studio-${audio.tool}-${Date.now()}.${extension}`,
          'audio'
        )
        assetId = asset.id
      } catch {
        // The in-tab blob still plays; history falls back to it.
      }
      const projectId = await ensureActiveStudioProjectId(generation.sessionId)
      await finalizeRun({
        generation,
        assetId,
        fallbackUrl: resultUrl,
        projectId,
      })
      await queryClient.invalidateQueries({ queryKey: ['playground', 'runs'] })
    },
    [finalizeRun, queryClient]
  )

  const enqueueJob = useCallback(
    (entry: PendingStudioRun) => {
      const limiter = studioGenerationLimiters[entry.input.modality]
      void limiter
        .schedule(async () => {
          // Cancelled while waiting for a slot: give the slot straight back.
          if (cancelledRef.current.has(entry.clientId)) return
          patchPending(entry.clientId, {
            status: 'running',
            startedAt: Date.now(),
          })
          if (entry.input.modality === 'image') {
            await executeImageRun(entry.input, entry.settings)
          } else if (entry.input.modality === 'video') {
            await executeVideoRun(entry.input, entry.settings)
          } else {
            await executeAudioRun(entry.input, entry.settings)
          }
          removePending([entry.clientId])
        })
        .catch((error: unknown) => {
          patchPending(entry.clientId, {
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          cancelledRef.current.delete(entry.clientId)
        })
    },
    [
      executeAudioRun,
      executeImageRun,
      executeVideoRun,
      patchPending,
      removePending,
    ]
  )

  /** Queues one job per prompt as a single batch; returns the batch id. */
  const startBatch = useCallback(
    (request: StudioBatchRequest): string => {
      const batchId = nanoid(12)
      const snapshot = { ...usePlaygroundStore.getState().studioSettings }
      const queuedAt = Date.now()
      const entries: PendingStudioRun[] = request.prompts.map((prompt) => ({
        clientId: nanoid(10),
        input: {
          modality: request.modality,
          sessionId: request.sessionId,
          model: request.model,
          group: request.group,
          references: request.references,
          audio: request.audio,
          batchId,
          prompt,
        },
        settings: snapshot,
        queuedAt,
        status: 'queued',
      }))
      updatePending((previous) => [...previous, ...entries])
      for (const entry of entries) enqueueJob(entry)
      return batchId
    },
    [enqueueJob, updatePending]
  )

  const retryRuns = useCallback(
    (clientIds: string[]) => {
      const ids = new Set(clientIds)
      const retried = pendingRef.current
        .filter((entry) => ids.has(entry.clientId) && entry.status === 'error')
        // queuedAt is kept: it anchors the batch card's place in the feed.
        .map(
          (entry): PendingStudioRun => ({
            ...entry,
            status: 'queued',
            error: undefined,
            startedAt: undefined,
          })
        )
      if (retried.length === 0) return
      const byId = new Map(retried.map((entry) => [entry.clientId, entry]))
      updatePending((previous) =>
        previous.map((entry) => byId.get(entry.clientId) ?? entry)
      )
      for (const entry of retried) enqueueJob(entry)
    },
    [enqueueJob, updatePending]
  )

  /** Drops queued jobs before they start; running jobs finish normally. */
  const cancelQueued = useCallback(
    (clientIds: string[]) => {
      const ids = new Set(clientIds)
      const queued = pendingRef.current.filter(
        (entry) => ids.has(entry.clientId) && entry.status === 'queued'
      )
      for (const entry of queued) cancelledRef.current.add(entry.clientId)
      removePending(queued.map((entry) => entry.clientId))
    },
    [removePending]
  )

  const dismissRuns = useCallback(
    (clientIds: string[]) => {
      const ids = new Set(clientIds)
      removePending(
        pendingRef.current
          .filter(
            (entry) => ids.has(entry.clientId) && entry.status === 'error'
          )
          .map((entry) => entry.clientId)
      )
    },
    [removePending]
  )

  return {
    settings,
    setSettings,
    pendingRuns,
    startBatch,
    retryRuns,
    cancelQueued,
    dismissRuns,
  }
}
