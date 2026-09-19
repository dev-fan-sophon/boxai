import {
  AudioLines,
  Clock,
  Gauge,
  Layers,
  Mic,
  Monitor,
  Proportions,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { usePlaygroundStore } from '@/stores/playground-store'

import {
  AUDIO_FORMATS,
  IMAGE_COUNTS,
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  SPEEDS,
  VIDEO_DURATIONS,
  VIDEO_SIZES,
  VOICES,
  imageQualityLabelKey,
  videoSizeLabel,
} from '../../lib/studio/generation-options'
import {
  normalizeImageGenerationSettings,
  type GptImageSize,
} from '../../lib/studio/image-request-schema'
import type { StudioModality, StudioSettings } from '../../types'
import { AspectGlyph, ParamChip } from './param-chip'

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
    return (
      <>
        <ParamChip
          icon={<Clock />}
          ariaLabel={t('Duration (seconds)')}
          valueLabel={`${settings.videoDuration}s`}
          value={String(settings.videoDuration)}
          onChange={(value) => update('videoDuration', Number(value))}
          options={VIDEO_DURATIONS.map((duration) => ({
            value: String(duration),
            label: `${duration}s`,
          }))}
        />
        <ParamChip
          icon={<Monitor />}
          ariaLabel={t('Video size')}
          valueLabel={videoSizeLabel(settings.videoSize)}
          value={settings.videoSize}
          onChange={(value) => update('videoSize', value)}
          options={VIDEO_SIZES.map((size) => ({
            value: size,
            label: videoSizeLabel(size),
          }))}
        />
      </>
    )
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
