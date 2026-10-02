import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { fetchPlaygroundAssetBlob } from '@/features/playground/api'
import { useComposerText } from '@/features/playground/components/composer/use-composer'
import { isStudioSession } from '@/features/playground/lib'
import { MAX_STUDIO_BATCH_JOBS } from '@/features/playground/lib/studio/batch-plan'
import {
  isPlaygroundImageModel,
  normalizeImageCount,
  UNSUPPORTED_IMAGE_MODEL_MESSAGE,
} from '@/features/playground/lib/studio/image-request-schema'
import { buildStudioFeed } from '@/features/playground/lib/studio/studio-feed'
import { usePlaygroundStore } from '@/stores/playground-store'

import type { MediaReference } from '../components/references/media-reference-slot'
import type { CreateTool } from '../constants'
import { blobToDataUrl } from '../lib/media'
import { useGenerationDraft } from './use-generation-draft'
import type { UseStudioResult } from './use-studio'

type ResultImage = { url: string; assetId?: number; prompt?: string }

/** An inpainting mask belongs to the reference it was painted on. */
type ImageMask = { referenceId: string; dataUrl: string }

/**
 * State and actions of one creation tool: the prompt and references being
 * drafted, the active project's feed (finished runs merged with in-flight
 * jobs), and every way a run can start — submit, re-run, vary, use a result
 * as the next reference. Submitting never blocks on a running batch; new
 * batches queue behind the per-modality limiter.
 */
export function useGenerationController(input: {
  modality: CreateTool
  studio: UseStudioResult
  canSubmit: () => boolean
}) {
  const { t } = useTranslation()
  const { modality, studio } = input
  const { text, setText } = useComposerText()
  const [references, setReferences] = useState<MediaReference[]>([])
  const [referenceVideos, setReferenceVideos] = useState<MediaReference[]>([])
  const [referenceAudios, setReferenceAudios] = useState<MediaReference[]>([])
  const [uploading, setUploading] = useState(false)
  const [mask, setMask] = useState<ImageMask | null>(null)
  const draft = useGenerationDraft({
    modality,
    text,
    references,
    referenceVideos,
    referenceAudios,
    uploading,
  })
  // Replacing or removing the first reference silently drops its mask.
  const activeMask =
    mask &&
    modality === 'image' &&
    draft.imageCapabilities?.supportsMask &&
    references[0]?.id === mask.referenceId
      ? mask.dataUrl
      : null
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )
  const activeSessionId = usePlaygroundStore(
    (state) => state.activeSessionByModality[modality] ?? null
  )
  const session = usePlaygroundStore((state) =>
    state.sessions.find((item) => item.id === activeSessionId)
  )
  const studioSession =
    session && isStudioSession(session) && session.modality === modality
      ? session
      : null

  const pending = useMemo(
    () =>
      studio.pendingRuns.filter(
        (entry) =>
          entry.input.modality === modality &&
          (!studioSession || entry.input.sessionId === studioSession.id)
      ),
    [studio.pendingRuns, modality, studioSession]
  )
  const batches = useMemo(
    () => buildStudioFeed(studioSession?.runs, pending),
    [studioSession?.runs, pending]
  )
  const activeJobs = studio.pendingRuns.filter(
    (entry) => entry.input.modality === modality && entry.status !== 'error'
  ).length

  /** Returns the active project id, creating a draft project when needed. */
  const ensureSessionId = (): string | undefined => {
    // Read the store, not the render snapshot: several scenes submitted in
    // one handler must all land in the project the first one created.
    const state = usePlaygroundStore.getState()
    const currentId = state.activeSessionByModality[modality]
    const current = state.sessions.find((item) => item.id === currentId)
    if (current && isStudioSession(current) && current.modality === modality) {
      return current.id
    }
    state.startNewSession(modality)
    return (
      usePlaygroundStore.getState().activeSessionByModality[modality] ??
      undefined
    )
  }

  /**
   * Queues one batch. `referenceUrls` replaces the drafted references for
   * this batch only (variations of a result), leaving the draft untouched.
   * Returns the batch id, or null when the run was refused.
   */
  const startJobs = (
    prompts: string[],
    referenceUrls?: string[]
  ): string | null => {
    const model = draft.model
    if (prompts.length === 0 || !model) return null
    if (!input.canSubmit()) return null
    const batchReferences =
      referenceUrls ?? references.map((reference) => reference.dataUrl)
    // Typed media belongs to the drafted references-mode run only; a run
    // seeded with explicit images (variations, storyboard scenes) omits it.
    const typedMedia = !referenceUrls && draft.referencesModeSelected
    const batchVideos = typedMedia
      ? referenceVideos.map((reference) => reference.dataUrl)
      : []
    const batchAudios = typedMedia
      ? referenceAudios.map((reference) => reference.dataUrl)
      : []
    if (batchReferences.length > draft.maxFiles) {
      toast.error(
        t('You can attach up to {{count}} images.', { count: draft.maxFiles })
      )
      return null
    }
    if (modality === 'image' && !isPlaygroundImageModel(model)) {
      toast.error(t(UNSUPPORTED_IMAGE_MODEL_MESSAGE))
      return null
    }
    if (
      batchVideos.length > draft.maxReferenceVideos ||
      batchAudios.length > draft.maxReferenceAudios
    ) {
      toast.error(
        t('Remove extra reference videos or audios before generating.')
      )
      return null
    }
    if (
      modality === 'video' &&
      draft.videoCapabilities?.requiresImage &&
      batchReferences.length === 0
    ) {
      toast.error(t('This model needs a reference image'))
      return null
    }
    const sessionId = ensureSessionId()
    if (!sessionId) return null
    if (modality === 'audio') {
      // A file tool always runs on the attached file, so "generate again"
      // re-labels the run from the current draft instead of reusing text.
      const audioPrompts = draft.usesAudioInput ? draft.plan.prompts : prompts
      if (audioPrompts.length === 0) return null
      return studio.startBatch({
        modality,
        sessionId,
        model,
        group: draft.group,
        references: draft.usesAudioInput ? batchReferences.slice(0, 1) : [],
        prompts: audioPrompts.slice(0, MAX_STUDIO_BATCH_JOBS),
        audio: {
          tool: draft.audio.tool,
          native: draft.audio.native,
          inputName: draft.usesAudioInput ? references[0]?.name : undefined,
        },
      })
    }
    return studio.startBatch({
      modality,
      sessionId,
      model,
      group: draft.group,
      references: batchReferences,
      referenceVideos: batchVideos.length ? batchVideos : undefined,
      referenceAudios: batchAudios.length ? batchAudios : undefined,
      // The mask only fits the drafted first reference, not variations.
      mask: referenceUrls ? undefined : (activeMask ?? undefined),
      prompts: prompts.slice(0, MAX_STUDIO_BATCH_JOBS),
    })
  }

  /**
   * Seeds the next run with a finished video's final frame as its first
   * frame, so the new clip continues where the previous one ended.
   */
  const continueFromFrame = (frameUrl: string) => {
    setReferences([
      { id: crypto.randomUUID(), name: t('Last frame'), dataUrl: frameUrl },
    ])
    setReferenceVideos([])
    setReferenceAudios([])
    setStudioSettings((prev) => ({ ...prev, videoReferenceMode: 'frames' }))
    toast.success(
      t('Last frame set as the first frame. Describe what happens next.')
    )
  }

  const submit = () => {
    if (!draft.canSubmit) return
    if (draft.plan.truncated > 0) {
      toast.warning(
        t('Batch limited to {{max}} results; {{count}} were skipped.', {
          max: MAX_STUDIO_BATCH_JOBS,
          count: draft.plan.truncated,
        })
      )
    }
    startJobs(draft.plan.prompts)
  }

  /** Reads a finished result back as an image data URL for a reference. */
  const loadResultReference = async (
    image: ResultImage
  ): Promise<MediaReference> => {
    const blob = image.assetId
      ? await fetchPlaygroundAssetBlob(image.assetId)
      : await (await fetch(image.url)).blob()
    const dataUrl = await blobToDataUrl(blob)
    if (!dataUrl.startsWith('data:image/')) {
      throw new Error('not an image')
    }
    return {
      id: crypto.randomUUID(),
      name: t('Generated image'),
      dataUrl,
      assetId: image.assetId,
    }
  }

  const addReferencesFromResults = async (images: ResultImage[]) => {
    const maxFiles = draft.maxFiles
    if (images.length > maxFiles) {
      toast.info(
        t('This model accepts up to {{count}} reference images.', {
          count: maxFiles,
        })
      )
    }
    const loaded = await Promise.allSettled(
      images.slice(0, maxFiles).map(loadResultReference)
    )
    const added = loaded.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    )
    const failed = loaded.length - added.length
    if (added.length === 0) {
      toast.error(t('Could not load this image as a reference.'))
      return
    }
    setReferences((previous) => [...previous, ...added].slice(-maxFiles))
    if (failed > 0) {
      toast.warning(
        t('{{count}} images could not be loaded as references.', {
          count: failed,
        })
      )
    }
    toast.success(
      added.length > 1
        ? t('Added {{count}} references. Describe your edit and send.', {
            count: added.length,
          })
        : t('Added as reference. Describe your edit and send.')
    )
  }

  /**
   * Variations: the result's prompt again, as a new batch of the current
   * count, editing from that image. The drafted references stay as-is.
   */
  const varyResult = async (image: ResultImage) => {
    const prompt = image.prompt?.trim()
    if (!prompt) {
      toast.error(t('This result has no prompt to vary.'))
      return
    }
    let reference: MediaReference
    try {
      reference = await loadResultReference(image)
    } catch {
      toast.error(t('Could not load this image as a reference.'))
      return
    }
    const count = normalizeImageCount(draft.settings.imageCount)
    startJobs(
      Array.from({ length: count }, () => prompt),
      [reference.dataUrl]
    )
  }

  const reusePrompt = (prompt: string) => {
    // A multi-prompt batch comes back as lines, so turn batch mode on for
    // the modalities that read one prompt per line.
    if (prompt.includes('\n') && modality !== 'audio') {
      setStudioSettings((prev) =>
        modality === 'image'
          ? { ...prev, imageBatchMode: true }
          : { ...prev, videoBatchMode: true }
      )
    }
    setText(prompt)
  }

  return {
    modality,
    text,
    setText,
    references,
    setReferences,
    referenceVideos,
    setReferenceVideos,
    referenceAudios,
    setReferenceAudios,
    mask: activeMask,
    setMask,
    uploading,
    setUploading,
    draft,
    studioSession,
    batches,
    activeJobs,
    ensureSessionId,
    startJobs,
    submit,
    addReferencesFromResults,
    varyResult,
    reusePrompt,
    loadResultReference,
    continueFromFrame,
  }
}

export type GenerationController = ReturnType<typeof useGenerationController>
