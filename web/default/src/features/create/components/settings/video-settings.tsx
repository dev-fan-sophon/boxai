import { useTranslation } from 'react-i18next'

import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { useVideoCapabilities } from '@/features/playground/hooks/use-video-capabilities'
import { BATCH_COUNTS } from '@/features/playground/lib/studio/batch-plan'
import {
  applyResolvedVideoSettings,
  resolveVideoOptions,
  videoResolutionsForRatio,
  type VideoAspectRatio,
} from '@/features/playground/lib/studio/video-capabilities'
import type { StudioSettings } from '@/features/playground/types'
import { usePlaygroundStore } from '@/stores/playground-store'

import { SettingRow } from './setting-row'

/** Video parameters resolved from the model's capability profile. */
export function VideoSettings(props: {
  videoMode?: 'text' | 'frames' | 'references'
  videoReferenceCount?: number
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
  const capabilities = videoCapabilityQuery.data?.[mode]
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
    { hasImage: Boolean(props.videoReferenceCount), mode }
  )
  const persistVideo = (patch: Partial<StudioSettings>) => {
    setStudioSettings((prev) =>
      applyResolvedVideoSettings(prev, capabilities, patch, {
        hasImage: Boolean(props.videoReferenceCount),
        mode,
      })
    )
  }
  const ratioLabel = (ratio: VideoAspectRatio) =>
    ratio === 'adaptive' ? t('Auto') : ratio

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
              {ratio === 'adaptive'
                ? t('Auto (match image)')
                : ratioLabel(ratio)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
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
          {videoResolutionsForRatio(capabilities, options.aspectRatio).map(
            (resolution) => (
              <NativeSelectOption key={resolution} value={resolution}>
                {resolution}
              </NativeSelectOption>
            )
          )}
        </NativeSelect>
      </SettingRow>
      <SettingRow label={t('Duration (seconds)')} htmlFor='gen-video-duration'>
        <NativeSelect
          id='gen-video-duration'
          size='sm'
          className='w-full'
          value={String(options.duration)}
          onChange={(event) =>
            persistVideo({ videoDuration: Number(event.target.value) })
          }
        >
          {capabilities.durations.map((duration) => (
            <NativeSelectOption key={duration} value={String(duration)}>
              {duration}s
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </SettingRow>
      {capabilities.supportsAudioToggle ? (
        <SettingRow label={t('Audio')} htmlFor='gen-video-audio'>
          <Switch
            id='gen-video-audio'
            size='sm'
            checked={options.generateAudio}
            onCheckedChange={(checked) =>
              persistVideo({ videoGenerateAudio: checked })
            }
          />
        </SettingRow>
      ) : null}
      {videoCapabilityQuery.data?.frames &&
      videoCapabilityQuery.data.references ? (
        <SettingRow label={t('Reference mode')} htmlFor='gen-video-ref-mode'>
          <NativeSelect
            id='gen-video-ref-mode'
            size='sm'
            className='w-full'
            value={options.referenceMode}
            onChange={(event) =>
              persistVideo({
                videoReferenceMode: event.target.value as
                  | 'frames'
                  | 'references',
              })
            }
          >
            <NativeSelectOption value='frames'>
              {t('Frames')}
            </NativeSelectOption>
            <NativeSelectOption value='references'>
              {t('References')}
            </NativeSelectOption>
          </NativeSelect>
        </SettingRow>
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
    </div>
  )
}
