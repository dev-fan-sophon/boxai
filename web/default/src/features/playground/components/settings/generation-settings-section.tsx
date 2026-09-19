import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { usePlaygroundStore } from '@/stores/playground-store'

import {
  AUDIO_FORMATS,
  IMAGE_COUNTS,
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  SPEEDS,
  VOICES,
  imageQualityLabelKey,
  imageSizeLabel,
} from '../../lib/studio/generation-options'
import {
  isPlaygroundImageModel,
  normalizeImageGenerationSettings,
  PLAYGROUND_IMAGE_MODEL,
} from '../../lib/studio/image-request-schema'
import {
  VIDEO_COUNTS,
  applyResolvedVideoSettings,
  getVideoModelCapabilities,
  resolveVideoOptions,
  type VideoAspectRatio,
} from '../../lib/studio/video-capabilities'
import type { StudioModality, StudioSettings } from '../../types'

/**
 * Generation parameters for the active non-chat modality.
 * Image controls use the OpenAI Images schema (quality/size/n) for every
 * allowed model (gpt-image-2 and grok-imagine-image).
 */
export function GenerationSettingsSection(props: {
  modality: Exclude<StudioModality, 'chat'>
}) {
  const { t } = useTranslation()
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )
  const model = usePlaygroundStore((state) => state.config.model)

  const update = <K extends keyof StudioSettings>(
    key: K,
    value: StudioSettings[K]
  ) => setStudioSettings((prev) => ({ ...prev, [key]: value }))

  if (props.modality === 'image') {
    const allowed = isPlaygroundImageModel(model)
    const normalized = normalizeImageGenerationSettings(settings)

    return (
      <div className='space-y-3'>
        {!allowed && (
          <p className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-2.5 py-2 text-[11px] text-pretty'>
            {t(
              'Playground image generation uses GPT-format models only (gpt-image-2 or grok-imagine-image). Select one and try again.'
            )}
          </p>
        )}
        {allowed && (
          <p className='border-border bg-muted/40 text-muted-foreground rounded-lg border px-2.5 py-2 text-[11px] text-pretty'>
            {t('Image model')}: {model || PLAYGROUND_IMAGE_MODEL}
          </p>
        )}
        <SettingRow label={t('Count')} htmlFor='gen-image-count'>
          <NativeSelect
            id='gen-image-count'
            size='sm'
            className='w-full'
            value={String(normalized.imageCount)}
            onChange={(event) =>
              update('imageCount', Number(event.target.value))
            }
          >
            {IMAGE_COUNTS.map((n) => (
              <NativeSelectOption key={n} value={String(n)}>
                {n}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </SettingRow>
        <SettingRow label={t('Size')} htmlFor='gen-image-size'>
          <NativeSelect
            id='gen-image-size'
            size='sm'
            className='w-full'
            value={normalized.imageSize}
            onChange={(event) => update('imageSize', event.target.value)}
          >
            {IMAGE_SIZES.map((size) => (
              <NativeSelectOption key={size} value={size}>
                {size === 'auto' ? t('Auto') : imageSizeLabel(size)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </SettingRow>
        <SettingRow label={t('Quality')} htmlFor='gen-image-quality'>
          <NativeSelect
            id='gen-image-quality'
            size='sm'
            className='w-full'
            value={normalized.imageQuality}
            onChange={(event) => update('imageQuality', event.target.value)}
          >
            {IMAGE_QUALITIES.map((quality) => (
              <NativeSelectOption key={quality} value={quality}>
                {t(imageQualityLabelKey(quality))}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </SettingRow>
      </div>
    )
  }

  if (props.modality === 'video') {
    const capabilities = getVideoModelCapabilities(model)
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
      { hasImage: true }
    )
    const persistVideo = (patch: Partial<StudioSettings>) => {
      setStudioSettings((prev) =>
        applyResolvedVideoSettings(prev, capabilities, patch)
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
            {capabilities.resolutions.map((resolution) => (
              <NativeSelectOption key={resolution} value={resolution}>
                {resolution}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </SettingRow>
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
        {capabilities.maxReferenceImages > 1 ? (
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
            {VIDEO_COUNTS.map((count) => (
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

  return (
    <div className='space-y-3'>
      <SettingRow label={t('Voice')} htmlFor='gen-audio-voice'>
        <NativeSelect
          id='gen-audio-voice'
          size='sm'
          className='w-full'
          value={settings.voice}
          onChange={(event) => update('voice', event.target.value)}
        >
          {VOICES.map((voice) => (
            <NativeSelectOption key={voice} value={voice}>
              {voice}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </SettingRow>
      <SettingRow label={t('Speed')} htmlFor='gen-audio-speed'>
        <NativeSelect
          id='gen-audio-speed'
          size='sm'
          className='w-full'
          value={String(settings.speed)}
          onChange={(event) => update('speed', Number(event.target.value))}
        >
          {SPEEDS.map((speed) => (
            <NativeSelectOption key={speed} value={String(speed)}>
              {speed}×
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </SettingRow>
      <SettingRow label={t('Format')} htmlFor='gen-audio-format'>
        <NativeSelect
          id='gen-audio-format'
          size='sm'
          className='w-full'
          value={settings.audioFormat}
          onChange={(event) => update('audioFormat', event.target.value)}
        >
          {AUDIO_FORMATS.map((format) => (
            <NativeSelectOption key={format} value={format}>
              {format}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </SettingRow>
    </div>
  )
}

function SettingRow(props: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className='space-y-1.5'>
      <Label htmlFor={props.htmlFor} className='text-xs'>
        {props.label}
      </Label>
      {props.children}
    </div>
  )
}
