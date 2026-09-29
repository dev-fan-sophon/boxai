import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { PricingModel } from '@/features/pricing/types'
import { cn } from '@/lib/utils'
import { usePlaygroundStore } from '@/stores/playground-store'

import { fetchPlaygroundAssetBlob } from '../../api'
import type { UseStudioResult } from '../../hooks/use-studio'
import { isStudioSession } from '../../lib'
import {
  MAX_STUDIO_BATCH_JOBS,
  type GenerationJobPlan,
} from '../../lib/studio/batch-plan'
import { isPlaygroundImageModel } from '../../lib/studio/image-request-schema'
import { buildStudioFeed } from '../../lib/studio/studio-feed'
import {
  getActiveVideoReferenceLimit,
  getVideoModelCapabilities,
  resolveVideoOptions,
} from '../../lib/studio/video-capabilities'
import type { StudioModality } from '../../types'
import type { MediaReference } from '../composer/attachments/media-reference-slot'
import { GenerationComposer } from '../composer/generation-composer'
import { ModelHero } from './model-hero'
import { StudioFeed } from './studio-feed'

type GenerationWorkspaceProps = {
  modality: Exclude<StudioModality, 'chat'>
  pricingModel?: PricingModel
  canSubmit: () => boolean
  studio: UseStudioResult
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')))
    reader.addEventListener('error', () =>
      reject(new Error('Could not read media blob'))
    )
    reader.readAsDataURL(blob)
  })
}

/**
 * Continuous generation workspace: a chronological feed of batch cards
 * (restored from the session's run history, with in-flight jobs merged in)
 * and the composer docked at the bottom. Submitting never blocks on a
 * running batch — new batches queue behind the per-modality limiter.
 */
export function GenerationWorkspace(props: GenerationWorkspaceProps) {
  const { t } = useTranslation()
  const { studio } = props
  const [references, setReferences] = useState<MediaReference[]>([])
  const [referenceModality, setReferenceModality] = useState(props.modality)

  const model = usePlaygroundStore((state) => state.config.model)
  const studioSettings = usePlaygroundStore((state) => state.studioSettings)
  const videoCapabilities = getVideoModelCapabilities(model)
  const videoOptions = resolveVideoOptions(
    videoCapabilities,
    {
      aspectRatio: studioSettings.videoAspectRatio,
      resolution: studioSettings.videoResolution,
      seconds: studioSettings.videoDuration,
      size: studioSettings.videoSize,
      generateAudio: studioSettings.videoGenerateAudio,
      referenceMode: studioSettings.videoReferenceMode,
      count: studioSettings.videoCount,
    },
    { hasImage: references.length > 0 }
  )
  let maxFiles = 4
  if (props.modality === 'video') {
    maxFiles = getActiveVideoReferenceLimit({
      model,
      referenceMode: videoOptions.referenceMode,
      disableLastFrame: studioSettings.videoDisableLastFrame,
    })
  }
  const group = usePlaygroundStore((state) => state.config.group)
  const setPrefill = usePlaygroundStore((state) => state.setPrefill)
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )
  const activeSessionId = usePlaygroundStore(
    (state) => state.activeSessionByModality[state.activeModality] ?? null
  )
  const session = usePlaygroundStore((state) =>
    state.sessions.find((item) => item.id === activeSessionId)
  )

  // References carry the editing chain within a modality; switching between
  // image and video (different reference semantics) clears them.
  if (referenceModality !== props.modality) {
    setReferenceModality(props.modality)
    setReferences([])
  }

  const studioSession =
    session && isStudioSession(session) && session.modality === props.modality
      ? session
      : null
  const pending = useMemo(
    () =>
      studio.pendingRuns.filter(
        (entry) =>
          entry.input.modality === props.modality &&
          (!studioSession || entry.input.sessionId === studioSession.id)
      ),
    [studio.pendingRuns, props.modality, studioSession]
  )
  const batches = useMemo(
    () => buildStudioFeed(studioSession?.runs, pending),
    [studioSession?.runs, pending]
  )

  const showHero = batches.length === 0
  const activeJobs = studio.pendingRuns.filter(
    (entry) =>
      entry.input.modality === props.modality && entry.status !== 'error'
  ).length

  const startJobs = (prompts: string[]) => {
    if (prompts.length === 0 || !model) return
    if (!props.canSubmit()) return
    if (references.length > maxFiles) {
      toast.error(
        t('You can attach up to {{count}} images.', { count: maxFiles })
      )
      return
    }
    if (props.modality === 'image' && !isPlaygroundImageModel(model)) {
      toast.error(
        t(
          'Playground image generation uses GPT-format models only (gpt-image-2 or grok-imagine-image). Select one and try again.'
        )
      )
      return
    }
    if (
      props.modality === 'video' &&
      videoCapabilities.requiresImage &&
      references.length === 0
    ) {
      toast.error(t('This model needs a reference image'))
      return
    }
    let sessionId = studioSession?.id
    if (!sessionId) {
      usePlaygroundStore.getState().startNewSession(props.modality)
      sessionId =
        usePlaygroundStore.getState().activeSessionByModality[props.modality] ??
        undefined
    }
    if (!sessionId) return
    studio.startBatch({
      modality: props.modality,
      sessionId,
      model,
      group,
      references:
        props.modality === 'audio'
          ? []
          : references.map((reference) => reference.dataUrl),
      prompts: prompts.slice(0, MAX_STUDIO_BATCH_JOBS),
    })
  }

  const submitPlan = (plan: GenerationJobPlan) => {
    if (plan.truncated > 0) {
      toast.warning(
        t('Batch limited to {{max}} results; {{count}} were skipped.', {
          max: MAX_STUDIO_BATCH_JOBS,
          count: plan.truncated,
        })
      )
    }
    startJobs(plan.prompts)
  }

  const addReferenceFromResult = async (image: {
    url: string
    assetId?: number
  }) => {
    try {
      const blob = image.assetId
        ? await fetchPlaygroundAssetBlob(image.assetId)
        : await (await fetch(image.url)).blob()
      const dataUrl = await blobToDataUrl(blob)
      if (!dataUrl.startsWith('data:image/')) {
        throw new Error('not an image')
      }
      setReferences((previous) => {
        const next = [
          ...previous,
          {
            id: crypto.randomUUID(),
            name: t('Generated image'),
            dataUrl,
            assetId: image.assetId,
          },
        ]
        return next.slice(-maxFiles)
      })
      toast.success(t('Added as reference. Describe your edit and send.'))
    } catch {
      toast.error(t('Could not load this image as a reference.'))
    }
  }

  const supportsReferences =
    props.modality === 'image' || props.modality === 'video'

  return (
    <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {showHero ? (
          <ModelHero
            model={props.pricingModel}
            modelName={model}
            modality={props.modality}
            onPickExample={setPrefill}
          />
        ) : (
          <div className='mx-auto w-full max-w-6xl px-3 pt-3 pb-6 sm:px-4 md:px-6'>
            <StudioFeed
              modality={props.modality}
              batches={batches}
              onReusePrompt={(prompt) => {
                // A multi-prompt batch comes back as lines, so turn batch
                // mode on for the modalities that read one prompt per line.
                if (prompt.includes('\n') && props.modality !== 'audio') {
                  setStudioSettings((prev) =>
                    props.modality === 'image'
                      ? { ...prev, imageBatchMode: true }
                      : { ...prev, videoBatchMode: true }
                  )
                }
                setPrefill(prompt)
              }}
              onRerun={startJobs}
              onUseAsReference={
                supportsReferences
                  ? (image) => void addReferenceFromResult(image)
                  : undefined
              }
              onRetry={studio.retryRuns}
              onCancelQueued={studio.cancelQueued}
              onDismiss={studio.dismissRuns}
            />
          </div>
        )}
      </div>

      <div
        className={cn(
          'playground-composer-dock border-border/60 bg-background/85 shrink-0 border-t backdrop-blur-xl',
          'supports-backdrop-filter:bg-background/72'
        )}
      >
        <GenerationComposer
          modality={props.modality}
          pricingModel={props.pricingModel}
          activeJobs={activeJobs}
          references={references}
          onReferencesChange={setReferences}
          onSubmit={submitPlan}
        />
      </div>
    </div>
  )
}
