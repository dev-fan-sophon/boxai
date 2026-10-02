import { Gauge, Layers, ListOrdered, Proportions } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  AspectGlyph,
  ParamChip,
  TogglePill,
} from '@/features/playground/components/composer/param-chip'
import {
  IMAGE_COUNTS,
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  imageQualityLabelKey,
} from '@/features/playground/lib/studio/generation-options'
import {
  normalizeImageGenerationSettings,
  type GptImageSize,
} from '@/features/playground/lib/studio/image-request-schema'
import type { StudioSettings } from '@/features/playground/types'
import { usePlaygroundStore } from '@/stores/playground-store'

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

/** Inline image parameters for the composer. */
export function ImageParamChips() {
  const { t } = useTranslation()
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )

  const update = <K extends keyof StudioSettings>(
    key: K,
    value: StudioSettings[K]
  ) => setStudioSettings((prev) => ({ ...prev, [key]: value }))

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
        ariaLabel={t('Images per prompt')}
        valueLabel={`×${normalized.imageCount}`}
        value={String(normalized.imageCount)}
        onChange={(value) => update('imageCount', Number(value))}
        options={IMAGE_COUNTS.map((count) => ({
          value: String(count),
          label: t('{{count}} images', { count }),
        }))}
      />
      <TogglePill
        icon={<ListOrdered />}
        label={t('Batch')}
        title={t('Enter several prompts and generate them at once')}
        active={settings.imageBatchMode}
        onToggle={() => update('imageBatchMode', !settings.imageBatchMode)}
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
