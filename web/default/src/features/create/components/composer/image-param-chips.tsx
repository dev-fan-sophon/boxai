import { useTranslation } from 'react-i18next'

import {
  FileImage,
  Gauge,
  Layers,
  Proportions,
  Scan,
  SquareDashed,
} from '@/components/icons'
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
  imagePixelSizeLabel,
  imageResolutionLabel,
} from '@/features/playground/lib/studio/image-capabilities'
import {
  isGeminiImageModel,
  type GptImageQuality,
} from '@/features/playground/lib/studio/image-request-schema'

import { useImageOptions } from '../../hooks/use-image-options'

function sizeChipLabel(size: string, t: (key: string) => string): string {
  if (size === 'auto') return t('Auto')
  return imagePixelSizeLabel(size).split(' · ')[0] ?? size
}

/** Inline image parameters for the composer, per the model capabilities. */
export function ImageParamChips() {
  const { t } = useTranslation()
  const state = useImageOptions()
  const capabilities = state.capabilities
  const options = state.options
  const aspectMode = capabilities?.sizeMode === 'aspect'
  const pixelMode = capabilities?.sizeMode === 'pixels'
  const legacy = !capabilities && !isGeminiImageModel(state.model)

  let sizes: string[] = []
  if (pixelMode) sizes = capabilities.sizes
  else if (legacy) sizes = [...IMAGE_SIZES]
  const currentSize = options?.size ?? state.normalized.imageSize

  let qualities: string[] = []
  if (capabilities) qualities = capabilities.qualities
  else if (legacy) qualities = [...IMAGE_QUALITIES]
  const currentQuality = options?.quality ?? state.normalized.imageQuality

  return (
    <>
      {aspectMode && options?.aspectRatio && (
        <ParamChip
          icon={<Proportions />}
          ariaLabel={t('Aspect ratio')}
          valueLabel={
            options.aspectRatio === 'auto' ? t('Auto') : options.aspectRatio
          }
          value={options.aspectRatio}
          onChange={(value) => state.update('imageAspectRatio', value)}
          options={capabilities.aspectRatios.map((ratio) => ({
            value: ratio,
            label: ratio === 'auto' ? t('Auto') : ratio,
            glyph: <AspectGlyph size={ratio} />,
          }))}
        />
      )}
      {aspectMode && capabilities.resolutions.length > 1 && (
        <ParamChip
          icon={<Scan />}
          ariaLabel={t('Resolution')}
          valueLabel={imageResolutionLabel(options?.resolution ?? '')}
          value={options?.resolution ?? ''}
          onChange={(value) => state.update('imageResolution', value)}
          options={capabilities.resolutions.map((resolution) => ({
            value: resolution,
            label: imageResolutionLabel(resolution),
          }))}
        />
      )}
      {sizes.length > 0 && (
        <ParamChip
          icon={<Proportions />}
          ariaLabel={t('Image size')}
          valueLabel={sizeChipLabel(currentSize, t)}
          value={currentSize}
          onChange={(value) => state.update('imageSize', value)}
          options={sizes.map((size) => ({
            value: size,
            label: size === 'auto' ? t('Auto') : imagePixelSizeLabel(size),
            glyph: <AspectGlyph size={size} />,
          }))}
        />
      )}
      <ParamChip
        icon={<Layers />}
        ariaLabel={t('Images per prompt')}
        valueLabel={`×${state.normalized.imageCount}`}
        value={String(state.normalized.imageCount)}
        onChange={(value) => state.update('imageCount', Number(value))}
        options={IMAGE_COUNTS.map((count) => ({
          value: String(count),
          label: t('{{count}} images', { count }),
        }))}
      />
      {qualities.length > 1 && (
        <ParamChip
          icon={<Gauge />}
          ariaLabel={t('Image quality')}
          valueLabel={t(
            imageQualityLabelKey(currentQuality as GptImageQuality)
          )}
          value={currentQuality}
          onChange={(value) => state.update('imageQuality', value)}
          options={qualities.map((quality) => ({
            value: quality,
            label: t(imageQualityLabelKey(quality as GptImageQuality)),
          }))}
        />
      )}
      {pixelMode && capabilities.backgrounds.includes('transparent') && (
        <TogglePill
          icon={<SquareDashed />}
          label={t('Transparent')}
          title={t('Transparent background (PNG or WebP)')}
          active={options?.background === 'transparent'}
          onToggle={() =>
            state.update(
              'imageBackground',
              options?.background === 'transparent' ? 'auto' : 'transparent'
            )
          }
        />
      )}
      {pixelMode && capabilities.outputFormats.length > 1 && (
        <ParamChip
          icon={<FileImage />}
          ariaLabel={t('Output format')}
          valueLabel={(options?.outputFormat ?? 'png').toUpperCase()}
          value={options?.outputFormat ?? 'png'}
          onChange={(value) => state.update('imageOutputFormat', value)}
          options={capabilities.outputFormats.map((format) => ({
            value: format,
            label: format.toUpperCase(),
            disabled:
              options?.background === 'transparent' && format === 'jpeg',
            hint:
              options?.background === 'transparent' && format === 'jpeg'
                ? t('JPEG has no transparency')
                : undefined,
          }))}
        />
      )}
    </>
  )
}
