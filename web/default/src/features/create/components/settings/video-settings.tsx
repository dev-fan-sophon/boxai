import { ChevronDown, Dices, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useVideoCapabilities } from '@/features/playground/hooks/use-video-capabilities'
import { BATCH_COUNTS } from '@/features/playground/lib/studio/batch-plan'
import {
  applyResolvedVideoSettings,
  MAX_VIDEO_SEED,
  resolveVideoOptions,
  videoDurationOptions,
  videoResolutionsForRatio,
  type VideoAspectRatio,
  type VideoResolution,
} from '@/features/playground/lib/studio/video-capabilities'
import type { StudioSettings } from '@/features/playground/types'
import { usePlaygroundStore } from '@/stores/playground-store'

import { SettingRow } from './setting-row'

/**
 * Video parameters resolved from the model's capability profile for the
 * active mode. Only controls the selected model supports are rendered;
 * options the current mode rules out are explained under the control.
 */
export function VideoSettings(props: {
  videoMode?: 'text' | 'frames' | 'references'
}) {
  const { t } = useTranslation()
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )
  const model = usePlaygroundStore((state) => state.config.model)
  const group = usePlaygroundStore((state) => state.config.group)
  const videoCapabilityQuery = useVideoCapabilities(group, model, true)

  const mode = props.videoMode ?? 'text'
  // The mode is derived from attached media, so a non-text mode has some.
  const hasImage = mode !== 'text'
  const profiles = videoCapabilityQuery.data
  const capabilities = profiles?.[mode]
  if (!capabilities) {
    let message = t('This video mode is unavailable for the selected model.')
    if (videoCapabilityQuery.isLoading) message = t('Loading video options…')
    else if (videoCapabilityQuery.isError) {
      message = t('Could not load video options. Retry to continue.')
    }
    return <p className='text-muted-foreground text-xs'>{message}</p>
  }
  const options = resolveVideoOptions(
    capabilities,
    {
      aspectRatio: settings.videoAspectRatio,
      resolution: settings.videoResolution,
      seconds: settings.videoDuration,
      size: settings.videoSize,
      generateAudio: settings.videoGenerateAudio,
      referenceMode: settings.videoReferenceMode,
      count: settings.videoCount,
    },
    { hasImage, mode }
  )
  const persistVideo = (patch: Partial<StudioSettings>) => {
    setStudioSettings((prev) =>
      applyResolvedVideoSettings(prev, capabilities, patch, { hasImage, mode })
    )
  }

  const resolutions = videoResolutionsForRatio(
    capabilities,
    options.aspectRatio
  )
  // Resolutions the model offers in another mode but not this one, e.g.
  // xAI reference-to-video is capped at 720p.
  const otherModeResolutions = new Set<VideoResolution>()
  for (const profile of Object.values(profiles ?? {})) {
    for (const resolution of profile?.resolutions ?? []) {
      if (!capabilities.resolutions.includes(resolution)) {
        otherModeResolutions.add(resolution)
      }
    }
  }
  let resolutionHint: string | null = null
  if (otherModeResolutions.size > 0) {
    resolutionHint = t('{{resolutions}} is not available in this mode.', {
      resolutions: [...otherModeResolutions].join(', '),
    })
  }
  const imageOnly = resolutions.filter(
    (resolution) =>
      !hasImage && capabilities.imageOnlyResolutions.includes(resolution)
  )
  if (imageOnly.length > 0) {
    resolutionHint = t('{{resolutions}} needs a reference image.', {
      resolutions: imageOnly.join(', '),
    })
  }

  const durations = videoDurationOptions(capabilities)
  const continuousDuration =
    durations.length > 1 &&
    durations.length ===
      capabilities.durationRange.max - capabilities.durationRange.min + 1
  const showAdvanced = Boolean(
    capabilities.supportsSeed || capabilities.supportsWatermark
  )
  const ratioLabel = (ratio: VideoAspectRatio) =>
    ratio === 'adaptive' ? t('Auto (match image)') : ratio

  return (
    <div className='space-y-3'>
      <SettingRow label={t('Aspect ratio')} htmlFor='gen-video-ratio'>
        <NativeSelect
          id='gen-video-ratio'
          size='sm'
          className='w-full'
          value={options.aspectRatio}
          onChange={(event) =>
            persistVideo({ videoAspectRatio: event.target.value })
          }
        >
          {capabilities.aspectRatios.map((ratio) => (
            <NativeSelectOption key={ratio} value={ratio}>
              {ratioLabel(ratio)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {capabilities.aspectRatios.length === 1 &&
        capabilities.aspectRatios[0] === 'adaptive' ? (
          <p className='text-muted-foreground text-2xs'>
            {t('This mode follows the shape of your frames.')}
          </p>
        ) : null}
      </SettingRow>
      <SettingRow label={t('Resolution')} htmlFor='gen-video-resolution'>
        <NativeSelect
          id='gen-video-resolution'
          size='sm'
          className='w-full'
          value={options.resolution}
          onChange={(event) =>
            persistVideo({ videoResolution: event.target.value })
          }
        >
          {resolutions.map((resolution) => (
            <NativeSelectOption
              key={resolution}
              value={resolution}
              disabled={imageOnly.includes(resolution)}
            >
              {resolution}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {resolutionHint ? (
          <p className='text-muted-foreground text-2xs'>{resolutionHint}</p>
        ) : null}
      </SettingRow>
      {continuousDuration ? (
        <div className='space-y-1.5'>
          <div className='flex items-center justify-between gap-2 text-xs'>
            <span id='gen-video-duration-label' className='font-medium'>
              {t('Duration')}
            </span>
            <span className='tabular-nums'>
              {t('{{count}}s', { count: options.duration })}
            </span>
          </div>
          <Slider
            aria-labelledby='gen-video-duration-label'
            min={capabilities.durationRange.min}
            max={capabilities.durationRange.max}
            step={1}
            value={[options.duration]}
            onValueChange={(value) => {
              const next = Array.isArray(value) ? value[0] : value
              if (typeof next === 'number' && next !== options.duration) {
                persistVideo({ videoDuration: next })
              }
            }}
          />
          <div className='text-muted-foreground text-2xs flex justify-between tabular-nums'>
            <span>
              {t('{{count}}s', { count: capabilities.durationRange.min })}
            </span>
            <span>
              {t('{{count}}s', { count: capabilities.durationRange.max })}
            </span>
          </div>
        </div>
      ) : (
        <SettingRow
          label={t('Duration (seconds)')}
          htmlFor='gen-video-duration'
        >
          <NativeSelect
            id='gen-video-duration'
            size='sm'
            className='w-full'
            value={String(options.duration)}
            onChange={(event) =>
              persistVideo({ videoDuration: Number(event.target.value) })
            }
          >
            {durations.map((duration) => (
              <NativeSelectOption key={duration} value={String(duration)}>
                {t('{{count}}s', { count: duration })}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </SettingRow>
      )}
      {capabilities.supportsAudioToggle ? (
        <div className='flex items-start justify-between gap-3'>
          <label htmlFor='gen-video-audio' className='space-y-0.5 text-xs'>
            <span className='block font-medium'>{t('Audio')}</span>
            <span className='text-muted-foreground text-2xs block'>
              {t('Generate sound and speech with the video.')}
            </span>
          </label>
          <Switch
            id='gen-video-audio'
            size='sm'
            checked={options.generateAudio}
            onCheckedChange={(checked) =>
              persistVideo({ videoGenerateAudio: checked })
            }
          />
        </div>
      ) : null}
      <SettingRow label={t('Videos per prompt')} htmlFor='gen-video-count'>
        <NativeSelect
          id='gen-video-count'
          size='sm'
          className='w-full'
          value={String(options.count)}
          onChange={(event) =>
            persistVideo({ videoCount: Number(event.target.value) })
          }
        >
          {BATCH_COUNTS.map((count) => (
            <NativeSelectOption key={count} value={String(count)}>
              {count}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </SettingRow>
      <SettingRow label={t('Batch')} htmlFor='gen-video-batch'>
        <Switch
          id='gen-video-batch'
          size='sm'
          checked={settings.videoBatchMode}
          onCheckedChange={(checked) =>
            persistVideo({ videoBatchMode: checked })
          }
        />
      </SettingRow>
      {showAdvanced ? (
        <VideoAdvancedSettings
          supportsSeed={Boolean(capabilities.supportsSeed)}
          supportsWatermark={Boolean(capabilities.supportsWatermark)}
        />
      ) : null}
    </div>
  )
}

/** Seed and watermark, folded away: most runs never need them. */
function VideoAdvancedSettings(props: {
  supportsSeed: boolean
  supportsWatermark: boolean
}) {
  const { t } = useTranslation()
  const seed = usePlaygroundStore((state) => state.studioSettings.videoSeed)
  const watermark = usePlaygroundStore(
    (state) => state.studioSettings.videoWatermark
  )
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )
  const setSeed = (value: number | null) =>
    setStudioSettings((prev) => ({ ...prev, videoSeed: value }))

  return (
    <Collapsible defaultOpen={typeof seed === 'number' || watermark === true}>
      <CollapsibleTrigger className='text-muted-foreground hover:text-foreground group flex w-full items-center justify-between py-1 text-xs font-medium'>
        {t('Advanced')}
        <ChevronDown
          className='duration-control size-3.5 transition-transform group-data-[panel-open]:rotate-180'
          aria-hidden='true'
        />
      </CollapsibleTrigger>
      <CollapsibleContent className='space-y-3 pt-2'>
        {props.supportsSeed ? (
          <SettingRow label={t('Seed')} htmlFor='gen-video-seed'>
            <div className='flex items-center gap-1'>
              <Input
                id='gen-video-seed'
                type='number'
                inputMode='numeric'
                min={-1}
                max={MAX_VIDEO_SEED}
                step={1}
                placeholder={t('Random')}
                className='h-8 text-sm tabular-nums'
                value={typeof seed === 'number' ? String(seed) : ''}
                onChange={(event) => {
                  const raw = event.target.value.trim()
                  const parsed = Number(raw)
                  if (!raw) setSeed(null)
                  else if (
                    Number.isInteger(parsed) &&
                    parsed >= -1 &&
                    parsed <= MAX_VIDEO_SEED
                  ) {
                    setSeed(parsed)
                  }
                }}
              />
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                aria-label={t('Random seed')}
                title={t('Random seed')}
                onClick={() =>
                  setSeed(Math.floor(Math.random() * MAX_VIDEO_SEED))
                }
              >
                <Dices aria-hidden='true' />
              </Button>
              {typeof seed === 'number' ? (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('Clear seed')}
                  title={t('Clear seed')}
                  onClick={() => setSeed(null)}
                >
                  <X aria-hidden='true' />
                </Button>
              ) : null}
            </div>
            <p className='text-muted-foreground text-2xs'>
              {t(
                'Reuse a seed with the same settings to get a similar result. Leave empty for a new one each run.'
              )}
            </p>
          </SettingRow>
        ) : null}
        {props.supportsWatermark ? (
          <div className='flex items-center justify-between gap-3'>
            <label htmlFor='gen-video-watermark' className='text-xs'>
              {t('Watermark')}
            </label>
            <Switch
              id='gen-video-watermark'
              size='sm'
              checked={watermark === true}
              onCheckedChange={(checked) =>
                setStudioSettings((prev) => ({
                  ...prev,
                  videoWatermark: checked,
                }))
              }
            />
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}
