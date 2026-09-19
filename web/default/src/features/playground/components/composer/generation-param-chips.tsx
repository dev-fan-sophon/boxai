import {
  AudioLines,
  Clock,
  Gauge,
  Layers,
  ListOrdered,
  Mic,
  Monitor,
  Proportions,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { usePlaygroundStore } from '@/stores/playground-store'

import {
  AUDIO_FORMATS,
  IMAGE_COUNTS,
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  SPEEDS,
  VOICES,
  imageQualityLabelKey,
} from '../../lib/studio/generation-options'
import {
  normalizeImageGenerationSettings,
  type GptImageSize,
} from '../../lib/studio/image-request-schema'
import {
  VIDEO_COUNTS,
  applyResolvedVideoSettings,
  getVideoModelCapabilities,
  resolveVideoOptions,
  type VideoAspectRatio,
} from '../../lib/studio/video-capabilities'
import type { StudioModality, StudioSettings } from '../../types'
import { AspectGlyph, ParamChip, TogglePill } from './param-chip'

function imageSizeChipLabel(
  size: GptImageSize,
  t: (key: string) => string
): string {
  if (size === 'auto') return t('Auto')
  if (size === '1024x1024') return '1:1'
  if (size === '1536x1024') return '3:2'
  if (size === '1024x1536') return '2:3'
  return size
}

/**
 * Inline generation parameters for the composer, per modality. Values are
 * shared with the settings panel through the studio settings store.
 */
export function GenerationParamChips(props: {
  modality: Exclude<StudioModality, 'chat'>
  hasImage?: boolean
}) {
  const { t } = useTranslation()
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )

  const update = <K extends keyof StudioSettings>(
    key: K,
    value: StudioSettings[K]
  ) => setStudioSettings((prev) => ({ ...prev, [key]: value }))

  if (props.modality === 'image') {
    const normalized = normalizeImageGenerationSettings(settings)
    return (
      <>
        <ParamChip
          icon={<Proportions />}
          ariaLabel={t('Image size')}
          valueLabel={imageSizeChipLabel(normalized.imageSize, t)}
          value={normalized.imageSize}
          onChange={(value) => update('imageSize', value)}
          options={IMAGE_SIZES.map((size) => ({
            value: size,
            label:
              size === 'auto'
                ? t('Auto')
                : `${imageSizeChipLabel(size, t)} · ${size.replace('x', '×')}`,
            glyph: <AspectGlyph size={size} />,
          }))}
        />
        <ParamChip
          icon={<Layers />}
          ariaLabel={t('Image count')}
          valueLabel={`×${normalized.imageCount}`}
          value={String(normalized.imageCount)}
          onChange={(value) => update('imageCount', Number(value))}
          options={IMAGE_COUNTS.map((count) => ({
            value: String(count),
            label: t('{{count}} images', { count }),
          }))}
        />
        <ParamChip
          icon={<Gauge />}
          ariaLabel={t('Image quality')}
          valueLabel={t(imageQualityLabelKey(normalized.imageQuality))}
          value={normalized.imageQuality}
          onChange={(value) => update('imageQuality', value)}
          options={IMAGE_QUALITIES.map((quality) => ({
            value: quality,
            label: t(imageQualityLabelKey(quality)),
          }))}
        />
      </>
    )
  }

  if (props.modality === 'video') {
    return <VideoParamChips hasImage={props.hasImage === true} />
  }

  return (
    <>
      <ParamChip
        icon={<Mic />}
        ariaLabel={t('Voice')}
        valueLabel={settings.voice}
        value={settings.voice}
        onChange={(value) => update('voice', value)}
        options={VOICES.map((voice) => ({ value: voice, label: voice }))}
      />
      <ParamChip
        icon={<Gauge />}
        ariaLabel={t('Speed')}
        valueLabel={`${settings.speed}×`}
        value={String(settings.speed)}
        onChange={(value) => update('speed', Number(value))}
        options={SPEEDS.map((speed) => ({
          value: String(speed),
          label: `${speed}×`,
        }))}
      />
      <ParamChip
        icon={<AudioLines />}
        ariaLabel={t('Format')}
        valueLabel={settings.audioFormat}
        value={settings.audioFormat}
        onChange={(value) => update('audioFormat', value)}
        options={AUDIO_FORMATS.map((format) => ({
          value: format,
          label: format,
        }))}
      />
    </>
  )
}

function VideoParamChips(props: { hasImage: boolean }) {
  const { t } = useTranslation()
  const model = usePlaygroundStore((state) => state.config.model)
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )
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
    { hasImage: props.hasImage }
  )

  const persist = (patch: Partial<StudioSettings>) =>
    setStudioSettings((prev) =>
      applyResolvedVideoSettings(prev, capabilities, patch, {
        hasImage: props.hasImage,
      })
    )

  const ratioLabel = (ratio: VideoAspectRatio) =>
    ratio === 'adaptive' ? t('Auto') : ratio

  return (
    <>
      <ParamChip
        icon={<Proportions />}
        ariaLabel={t('Aspect ratio')}
        valueLabel={ratioLabel(options.aspectRatio)}
        value={options.aspectRatio}
        onChange={(aspectRatio) => persist({ videoAspectRatio: aspectRatio })}
        options={capabilities.aspectRatios.map((ratio) => ({
          value: ratio,
          label:
            ratio === 'adaptive' ? t('Auto (match image)') : ratioLabel(ratio),
          glyph: <AspectGlyph size={ratio} />,
        }))}
      />
      <ParamChip
        icon={<Monitor />}
        ariaLabel={t('Resolution')}
        valueLabel={options.resolution}
        value={options.resolution}
        onChange={(resolution) => persist({ videoResolution: resolution })}
        options={capabilities.resolutions.map((resolution) => {
          const needsImage =
            capabilities.imageOnlyResolutions.includes(resolution) &&
            !props.hasImage
          return {
            value: resolution,
            label: resolution,
            disabled: needsImage,
            hint: needsImage ? t('Needs a reference image') : undefined,
          }
        })}
      />
      <ParamChip
        icon={<Clock />}
        ariaLabel={t('Duration (seconds)')}
        valueLabel={`${options.duration}s`}
        value={String(options.duration)}
        onChange={(seconds) => persist({ videoDuration: Number(seconds) })}
        options={capabilities.durations.map((duration) => ({
          value: String(duration),
          label: t('{{count}}s', { count: duration }),
        }))}
      />
      {capabilities.supportsAudioToggle ? (
        <TogglePill
          icon={options.generateAudio ? <Volume2 /> : <VolumeX />}
          label={options.generateAudio ? t('Audio') : t('Muted')}
          title={t('Generate audio with the video')}
          active={options.generateAudio}
          onToggle={() =>
            persist({ videoGenerateAudio: !options.generateAudio })
          }
        />
      ) : null}
      <ParamChip
        icon={<Layers />}
        ariaLabel={t('Videos per prompt')}
        valueLabel={`×${options.count}`}
        value={String(options.count)}
        onChange={(count) => persist({ videoCount: Number(count) })}
        options={VIDEO_COUNTS.map((count) => ({
          value: String(count),
          label: t('{{count}} videos', { count }),
        }))}
      />
      <TogglePill
        icon={<ListOrdered />}
        label={t('Batch')}
        title={t('Enter several prompts and generate them at once')}
        active={settings.videoBatchMode}
        onToggle={() => persist({ videoBatchMode: !settings.videoBatchMode })}
      />
    </>
  )
}
