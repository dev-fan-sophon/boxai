import { useTranslation } from 'react-i18next'

import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import {
  IMAGE_COUNTS,
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  imageQualityLabelKey,
  imageSizeLabel,
} from '@/features/playground/lib/studio/generation-options'
import {
  imagePixelSizeLabel,
  imageResolutionLabel,
} from '@/features/playground/lib/studio/image-capabilities'
import {
  isGeminiImageModel,
  isPlaygroundImageModel,
  type GptImageQuality,
} from '@/features/playground/lib/studio/image-request-schema'

import { useImageOptions } from '../../hooks/use-image-options'
import { ImageAspectRatioGrid } from './image-aspect-ratio-grid'
import { SettingRow } from './setting-row'

type ImageOptionsState = ReturnType<typeof useImageOptions>

function backgroundLabel(background: string, t: (key: string) => string) {
  switch (background) {
    case 'transparent':
      return t('Transparent')
    case 'opaque':
      return t('Opaque')
    case 'auto':
      return t('Auto')
    default:
      return background
  }
}

/** Image parameters, limited to what the selected model supports. */
export function ImageSettings() {
  const { t } = useTranslation()
  const state = useImageOptions()
  const allowed = isPlaygroundImageModel(state.model)
  const capabilities = state.capabilities

  return (
    <div className='space-y-3'>
      {!allowed && (
        <p className='border-destructive/30 bg-destructive/5 text-destructive text-2xs rounded-lg border px-2.5 py-2 text-pretty'>
          {t(
            'Image generation supports GPT Image, Grok Imagine and Gemini image models. Select one and try again.'
          )}
        </p>
      )}
      {allowed && capabilities && capabilities.maxReferenceImages > 0 && (
        <p className='border-border bg-muted/40 text-muted-foreground text-2xs rounded-lg border px-2.5 py-2 text-pretty'>
          {t('Up to {{count}} reference images for editing', {
            count: capabilities.maxReferenceImages,
          })}
          {capabilities.supportsMask
            ? ` · ${t('Paint a mask on the first reference to edit only that area')}`
            : ''}
        </p>
      )}
      <SettingRow label={t('Images per prompt')} htmlFor='gen-image-count'>
        <NativeSelect
          id='gen-image-count'
          size='sm'
          className='w-full'
          value={String(state.normalized.imageCount)}
          onChange={(event) =>
            state.update('imageCount', Number(event.target.value))
          }
        >
          {IMAGE_COUNTS.map((n) => (
            <NativeSelectOption key={n} value={String(n)}>
              {n}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </SettingRow>
      <SettingRow label={t('Batch')} htmlFor='gen-image-batch'>
        <Switch
          id='gen-image-batch'
          size='sm'
          checked={state.settings.imageBatchMode}
          onCheckedChange={(checked) => state.update('imageBatchMode', checked)}
        />
      </SettingRow>
      {capabilities?.sizeMode === 'aspect' && <AspectControls state={state} />}
      {capabilities?.sizeMode === 'pixels' && <PixelControls state={state} />}
      {!capabilities && allowed && !isGeminiImageModel(state.model) && (
        <LegacyGptControls state={state} />
      )}
    </div>
  )
}

/** Grok / Gemini: aspect ratio + resolution (+ quality for Grok). */
function AspectControls(props: { state: ImageOptionsState }) {
  const { t } = useTranslation()
  const capabilities = props.state.capabilities
  const options = props.state.options
  if (!capabilities || !options) return null
  return (
    <>
      {capabilities.aspectRatios.length > 0 && (
        <SettingRow label={t('Aspect ratio')} htmlFor='gen-image-ratio'>
          <ImageAspectRatioGrid
            id='gen-image-ratio'
            ratios={capabilities.aspectRatios}
            value={options.aspectRatio}
            onChange={(ratio) => props.state.update('imageAspectRatio', ratio)}
          />
        </SettingRow>
      )}
      {capabilities.resolutions.length > 1 && (
        <SettingRow label={t('Resolution')} htmlFor='gen-image-resolution'>
          <SegmentedControl
            fullWidth
            size='sm'
            aria-label={t('Resolution')}
            value={options.resolution ?? ''}
            options={capabilities.resolutions.map((resolution) => ({
              value: resolution,
              label: imageResolutionLabel(resolution),
            }))}
            onValueChange={(resolution) =>
              props.state.update('imageResolution', resolution)
            }
          />
        </SettingRow>
      )}
      {capabilities.qualities.length > 1 && (
        <SettingRow label={t('Quality')} htmlFor='gen-image-quality'>
          <NativeSelect
            id='gen-image-quality'
            size='sm'
            className='w-full'
            value={options.quality ?? ''}
            onChange={(event) =>
              props.state.update('imageQuality', event.target.value)
            }
          >
            {capabilities.qualities.map((quality) => (
              <NativeSelectOption key={quality} value={quality}>
                {t(imageQualityLabelKey(quality as GptImageQuality))}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </SettingRow>
      )}
    </>
  )
}

/** GPT Image: pixel size, quality, background and output format. */
function PixelControls(props: { state: ImageOptionsState }) {
  const { t } = useTranslation()
  const capabilities = props.state.capabilities
  const options = props.state.options
  if (!capabilities || !options) return null
  const transparent = options.background === 'transparent'
  return (
    <>
      <SettingRow label={t('Size')} htmlFor='gen-image-size'>
        <NativeSelect
          id='gen-image-size'
          size='sm'
          className='w-full'
          value={options.size ?? ''}
          onChange={(event) =>
            props.state.update('imageSize', event.target.value)
          }
        >
          {capabilities.sizes.map((size) => (
            <NativeSelectOption key={size} value={size}>
              {size === 'auto' ? t('Auto') : imagePixelSizeLabel(size)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </SettingRow>
      <SettingRow label={t('Quality')} htmlFor='gen-image-quality'>
        <NativeSelect
          id='gen-image-quality'
          size='sm'
          className='w-full'
          value={options.quality ?? ''}
          onChange={(event) =>
            props.state.update('imageQuality', event.target.value)
          }
        >
          {capabilities.qualities.map((quality) => (
            <NativeSelectOption key={quality} value={quality}>
              {t(imageQualityLabelKey(quality as GptImageQuality))}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </SettingRow>
      {capabilities.backgrounds.length > 1 && (
        <SettingRow label={t('Background')} htmlFor='gen-image-background'>
          <SegmentedControl
            fullWidth
            size='sm'
            aria-label={t('Background')}
            value={options.background ?? 'auto'}
            options={capabilities.backgrounds.map((background) => ({
              value: background,
              label: backgroundLabel(background, t),
            }))}
            onValueChange={(background) =>
              props.state.update('imageBackground', background)
            }
          />
        </SettingRow>
      )}
      {capabilities.outputFormats.length > 1 && (
        <SettingRow label={t('Output format')} htmlFor='gen-image-format'>
          <NativeSelect
            id='gen-image-format'
            size='sm'
            className='w-full'
            value={options.outputFormat ?? ''}
            onChange={(event) =>
              props.state.update('imageOutputFormat', event.target.value)
            }
          >
            {capabilities.outputFormats.map((format) => (
              <NativeSelectOption
                key={format}
                value={format}
                disabled={transparent && format === 'jpeg'}
              >
                {format.toUpperCase()}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </SettingRow>
      )}
    </>
  )
}

/** Guests and unreachable capabilities: the historical GPT size/quality. */
function LegacyGptControls(props: { state: ImageOptionsState }) {
  const { t } = useTranslation()
  return (
    <>
      <SettingRow label={t('Size')} htmlFor='gen-image-size'>
        <NativeSelect
          id='gen-image-size'
          size='sm'
          className='w-full'
          value={props.state.normalized.imageSize}
          onChange={(event) =>
            props.state.update('imageSize', event.target.value)
          }
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
          value={props.state.normalized.imageQuality}
          onChange={(event) =>
            props.state.update('imageQuality', event.target.value)
          }
        >
          {IMAGE_QUALITIES.map((quality) => (
            <NativeSelectOption key={quality} value={quality}>
              {t(imageQualityLabelKey(quality))}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </SettingRow>
    </>
  )
}
