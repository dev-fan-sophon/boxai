import { useTranslation } from 'react-i18next'

import type { PricingModel } from '@/features/pricing/types'
import { cn } from '@/lib/utils'
import { usePlaygroundStore } from '@/stores/playground-store'

import {
  MAX_VIDEO_BATCH_JOBS,
  getActiveVideoReferenceLimit,
  getVideoModelCapabilities,
  planVideoJobs,
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
  isPending: boolean
  references: MediaReference[]
  onReferencesChange: (value: MediaReference[]) => void
  onSubmit: (prompt: string) => void
}

/**
 * Composer for image/video/audio generation: shared skeleton plus the
 * media reference slot (image reference / video first frame) and the
 * price hint. Generation parameters live in the settings panel.
 */
export function GenerationComposer(props: GenerationComposerProps) {
  const { t } = useTranslation()
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
  const videoPlan =
    props.modality === 'video'
      ? planVideoJobs({
          text,
          batchMode: settings.videoBatchMode,
          count: videoOptions.count,
        })
      : null
  const canSubmit =
    Boolean(model) &&
    (props.modality === 'video'
      ? videoPlan !== null && videoPlan.prompts.length > 0
      : Boolean(text.trim()))

  const submit = () => {
    if (!canSubmit || !model) return
    props.onSubmit(text)
    if (props.modality !== 'video' || !settings.videoBatchMode) {
      setText('')
    }
  }

  let placeholder = t('Describe what you want to create…')
  if (props.modality === 'audio') {
    placeholder = t('Enter the text to speak…')
  } else if (props.modality === 'video' && settings.videoBatchMode) {
    placeholder = t('One prompt per line (up to {{max}} videos)', {
      max: MAX_VIDEO_BATCH_JOBS,
    })
  } else if (props.modality === 'video') {
    placeholder = t('Describe the video scene and motion…')
  } else if (props.modality === 'image') {
    placeholder = t('Describe the image you want to create…')
  }

  return (
    <div className='playground-composer-dock mx-auto w-full max-w-4xl shrink-0 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] sm:px-3 sm:py-3 md:px-3 md:py-3.5'>
      {props.isPending && (
        <p className='text-muted-foreground mb-2 px-1 text-center text-[11px]'>
          {t('Generating… you can already queue the next run.')}
        </p>
      )}
      <ComposerShell
        text={text}
        onTextChange={setText}
        onSubmit={submit}
        placeholder={placeholder}
        canSubmit={canSubmit}
        tools={
          <div className='flex min-w-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto py-0.5 [&::-webkit-scrollbar]:hidden'>
            {showMediaSlot && (
              <MediaReferenceSlot
                label={mediaLabel}
                value={props.references}
                onChange={props.onReferencesChange}
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
                className='bg-foreground/5 flex shrink-0 rounded-full p-0.5 text-[10px] font-medium'
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
              <label className='text-muted-foreground flex shrink-0 items-center gap-1 text-[10px]'>
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
            estimateParams={{
              modality: props.modality,
              n:
                props.modality === 'video'
                  ? Math.max(1, videoPlan?.prompts.length ?? 1)
                  : settings.imageCount,
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
