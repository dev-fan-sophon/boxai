import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type { PricingModel } from '@/features/pricing/types'
import { cn } from '@/lib/utils'
import { usePlaygroundStore } from '@/stores/playground-store'

import { fetchPlaygroundAssetBlob } from '../../api'
import type { UseStudioResult } from '../../hooks/use-studio'
import { isStudioSession } from '../../lib'
import { isPlaygroundImageModel } from '../../lib/studio/image-request-schema'
import { groupRunsIntoBatches } from '../../lib/studio/studio-feed'
import {
  MAX_VIDEO_BATCH_JOBS,
  getActiveVideoReferenceLimit,
  getVideoModelCapabilities,
  planVideoJobs,
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
 * Continuous generation workspace: a chronological feed of prompt + result
 * cards (restored from the session's run history) with the composer docked
 * at the bottom. Submitting never blocks on a running generation — new runs
 * append to the feed as pending cards.
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
  const activeModality = usePlaygroundStore((state) => state.activeModality)
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
  const batches = useMemo(
    () => groupRunsIntoBatches(studioSession?.runs),
    [studioSession?.runs]
  )
  const pending = useMemo(
    () =>
      studio.pendingRuns.filter(
        (entry) =>
          entry.input.modality === props.modality &&
          (!studioSession || entry.input.sessionId === studioSession.id)
      ),
    [studio.pendingRuns, props.modality, studioSession]
  )

  const showHero = batches.length === 0 && pending.length === 0
  const hasRunning = pending.some((entry) => entry.status === 'running')

  const submit = (prompt: string) => {
    if (!prompt || !model) return
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
    const referenceUrls =
      props.modality === 'audio'
        ? []
        : references.map((reference) => reference.dataUrl)
    if (props.modality === 'video') {
      const plan = planVideoJobs({
        text: prompt,
        batchMode: studioSettings.videoBatchMode,
        count: videoOptions.count,
      })
      if (plan.prompts.length === 0) return
      if (plan.truncated > 0) {
        toast.warning(
          t(
            'Batch limited to {{max}} videos; {{count}} prompts were skipped.',
            {
              max: MAX_VIDEO_BATCH_JOBS,
              count: plan.truncated,
            }
          )
        )
      }
      for (const jobPrompt of plan.prompts) {
        studio.startGeneration({
          modality: 'video',
          sessionId,
          prompt: jobPrompt,
          model,
          group,
          references: referenceUrls,
        })
      }
      return
    }
    studio.startGeneration({
      modality: props.modality,
      sessionId,
      prompt,
      model,
      group,
      references: referenceUrls,
    })
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
          />
        ) : (
          <div className='mx-auto w-full max-w-5xl px-3 pt-4 pb-6 sm:px-4 md:px-6'>
            <StudioFeed
              modality={props.modality}
              batches={batches}
              pending={pending}
              onReusePrompt={(prompt) => setPrefill(prompt)}
              onRerun={(prompt) => submit(prompt)}
              onUseAsReference={
                supportsReferences
                  ? (image) => void addReferenceFromResult(image)
                  : undefined
              }
              onRetryPending={studio.retryRun}
              onDismissPending={studio.dismissRun}
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
          isPending={hasRunning && activeModality === props.modality}
          references={references}
          onReferencesChange={setReferences}
          onSubmit={submit}
        />
      </div>
    </div>
  )
}
