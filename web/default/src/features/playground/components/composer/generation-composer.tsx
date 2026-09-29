import { Layers } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PricingModel } from '@/features/pricing/types'
import { cn } from '@/lib/utils'
import { usePlaygroundStore } from '@/stores/playground-store'

import {
  MAX_STUDIO_BATCH_JOBS,
  planGenerationJobs,
  type GenerationJobPlan,
} from '../../lib/studio/batch-plan'
import { normalizeImageCount } from '../../lib/studio/image-request-schema'
import {
  getActiveVideoReferenceLimit,
  getVideoModelCapabilities,
  resolveVideoOptions,
  videoSizeForOptions,
  type VideoReferenceMode,
} from '../../lib/studio/video-capabilities'
import type { StudioModality } from '../../types'
import {
  MediaReferenceSlot,
  type MediaReference,
} from './attachments/media-reference-slot'
import { ComposerShell } from './composer'
import { GenerationParamChips } from './generation-param-chips'
import { PriceHintBadge } from './price-hint'
import { useComposerText } from './use-composer'

type GenerationComposerProps = {
  modality: Exclude<StudioModality, 'chat'>
  pricingModel?: PricingModel
  /** Jobs of this modality still queued or running. */
  activeJobs: number
  references: MediaReference[]
  onReferencesChange: (value: MediaReference[]) => void
  onSubmit: (plan: GenerationJobPlan) => void
}

/**
 * Composer for image/video/audio generation. The prompt box expands into a
 * batch plan (lines × `{a|b}` variants × count) that is previewed live, so
 * the send button and the price hint always describe the whole batch.
 * The prompt stays in the box after sending so it can be tweaked and re-run.
 */
export function GenerationComposer(props: GenerationComposerProps) {
  const { t } = useTranslation()
  const [uploading, setUploading] = useState(false)
  const { text, setText } = useComposerText()
  const model = usePlaygroundStore((state) => state.config.model)
  const group = usePlaygroundStore((state) => state.config.group)
  const groups = usePlaygroundStore((state) => state.groups)
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )

  const videoCapabilities = getVideoModelCapabilities(model)
  const videoOptions = resolveVideoOptions(
    videoCapabilities,
    {
      aspectRatio: settings.videoAspectRatio,
      resolution: settings.videoResolution,
      seconds: settings.videoDuration,
      size: settings.videoSize,
      generateAudio: settings.videoGenerateAudio,
      referenceMode: settings.videoReferenceMode,
      count: settings.videoCount,
    },
    { hasImage: props.references.length > 0 }
  )
  const usesLastFrame =
    props.modality === 'video' &&
    videoOptions.referenceMode === 'frames' &&
    videoCapabilities.supportsLastFrame &&
    !settings.videoDisableLastFrame
  let maxFiles = 4
  if (props.modality === 'video') {
    maxFiles = getActiveVideoReferenceLimit({
      model,
      referenceMode: videoOptions.referenceMode,
      disableLastFrame: settings.videoDisableLastFrame,
    })
  }
  let mediaLabel = t('Reference image')
  if (props.modality === 'video' && videoOptions.referenceMode === 'frames') {
    mediaLabel = usesLastFrame ? t('First and last frame') : t('First frame')
  }
  const groupRatio = groups.find((item) => item.value === group)?.ratio
  const showMediaSlot = props.modality === 'image' || props.modality === 'video'

  let batchMode = false
  let count = 1
  if (props.modality === 'image') {
    batchMode = settings.imageBatchMode
    count = normalizeImageCount(settings.imageCount)
  } else if (props.modality === 'video') {
    batchMode = settings.videoBatchMode
    count = videoOptions.count
  }
  // Speech text is spoken verbatim, so it never expands into variants.
  const plan: GenerationJobPlan =
    props.modality === 'audio'
      ? { prompts: text.trim() ? [text.trim()] : [], truncated: 0 }
      : planGenerationJobs({ text, batchMode, count })
  const jobCount = plan.prompts.length
  const distinctPrompts = new Set(plan.prompts).size
  const canSubmit = !uploading && Boolean(model) && jobCount > 0

  const submit = () => {
    if (!canSubmit || !model) return
    props.onSubmit(plan)
  }

  let placeholder = t('Describe what you want to create…')
  if (props.modality === 'audio') {
    placeholder = t('Enter the text to speak…')
  } else if (batchMode) {
    placeholder = t('One prompt per line · use {a|b} for variants')
  } else if (props.modality === 'video') {
    placeholder = t('Describe the video scene and motion…')
  } else if (props.modality === 'image') {
    placeholder = t('Describe the image you want to create…')
  }

  let submitLabel = t('Generate')
  if (jobCount > 1) {
    submitLabel = t('Generate ×{{count}}', { count: jobCount })
  }

  let planSummary = ''
  if (jobCount > 1 && distinctPrompts > 1) {
    planSummary = t('{{count}} results from {{prompts}} prompts', {
      count: jobCount,
      prompts: distinctPrompts,
    })
  } else if (jobCount > 1) {
    planSummary = t('{{count}} results', { count: jobCount })
  }

  return (
    <div className='playground-composer-dock mx-auto w-full max-w-4xl shrink-0 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] sm:px-3 sm:py-3 md:px-3 md:py-3.5'>
      {(props.activeJobs > 0 || planSummary || plan.truncated > 0) && (
        <div
          className='text-muted-foreground mb-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-1 text-center text-xs'
          aria-live='polite'
        >
          {planSummary ? (
            <span className='text-foreground/80 inline-flex items-center gap-1 font-medium'>
              <Layers className='size-3.5' aria-hidden='true' />
              {planSummary}
            </span>
          ) : null}
          {plan.truncated > 0 ? (
            <span className='text-warning'>
              {t('{{count}} more skipped (max {{max}} per run)', {
                count: plan.truncated,
                max: MAX_STUDIO_BATCH_JOBS,
              })}
            </span>
          ) : null}
          {props.activeJobs > 0 ? (
            <span>
              {t('{{count}} in progress — you can keep queuing', {
                count: props.activeJobs,
              })}
            </span>
          ) : null}
        </div>
      )}
      <ComposerShell
        text={text}
        onTextChange={setText}
        onSubmit={submit}
        placeholder={placeholder}
        canSubmit={canSubmit}
        submitLabel={submitLabel}
        newlineOnEnter={batchMode}
        tools={
          <div className='flex min-w-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto py-0.5 [&::-webkit-scrollbar]:hidden'>
            {showMediaSlot && (
              <MediaReferenceSlot
                label={mediaLabel}
                value={props.references}
                onChange={props.onReferencesChange}
                onUploadingChange={setUploading}
                attachable
                kind='image'
                maxFiles={maxFiles}
                roleForIndex={
                  props.modality === 'video'
                    ? (index) => {
                        if (videoOptions.referenceMode === 'references') {
                          return `${index + 1}`
                        }
                        if (index === 0) return t('First')
                        if (index === 1 && usesLastFrame) return t('Last')
                        return '—'
                      }
                    : undefined
                }
              />
            )}
            {props.modality === 'video' &&
            videoCapabilities.maxReferenceImages > 1 ? (
              <div
                className='bg-foreground/5 text-3xs flex shrink-0 rounded-full p-0.5 font-medium'
                role='radiogroup'
                aria-label={t('Reference mode')}
              >
                {(['frames', 'references'] as VideoReferenceMode[]).map(
                  (mode) => (
                    <button
                      key={mode}
                      type='button'
                      role='radio'
                      aria-checked={videoOptions.referenceMode === mode}
                      className={cn(
                        'rounded-full px-2 py-0.5 transition-colors',
                        videoOptions.referenceMode === mode
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() =>
                        setStudioSettings((prev) => ({
                          ...prev,
                          videoReferenceMode: mode,
                        }))
                      }
                    >
                      {mode === 'frames' ? t('Frames') : t('References')}
                    </button>
                  )
                )}
              </div>
            ) : null}
            {props.modality === 'video' &&
            videoOptions.referenceMode === 'frames' &&
            videoCapabilities.supportsLastFrame &&
            props.references.length > 1 ? (
              <label className='text-muted-foreground text-3xs flex shrink-0 items-center gap-1'>
                <input
                  type='checkbox'
                  className='size-3'
                  checked={!settings.videoDisableLastFrame}
                  onChange={(event) =>
                    setStudioSettings((prev) => ({
                      ...prev,
                      videoDisableLastFrame: !event.target.checked,
                    }))
                  }
                />
                {t('Last frame')}
              </label>
            ) : null}
            <GenerationParamChips
              modality={props.modality}
              hasImage={props.references.length > 0}
            />
          </div>
        }
        trailing={
          <PriceHintBadge
            model={props.pricingModel}
            group={group}
            groupRatio={groupRatio}
            jobCount={jobCount}
            estimateParams={{
              modality: props.modality,
              n: Math.max(1, jobCount),
              size:
                props.modality === 'video'
                  ? (videoSizeForOptions(
                      videoOptions.aspectRatio,
                      videoOptions.resolution
                    ) ?? settings.videoSize)
                  : settings.imageSize,
              duration:
                props.modality === 'video' ? videoOptions.duration : undefined,
              has_reference: props.references.length > 0,
            }}
          />
        }
        className='px-0'
      />
    </div>
  )
}
