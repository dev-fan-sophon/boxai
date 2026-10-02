import { useTranslation } from 'react-i18next'

import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import {
  IMAGE_COUNTS,
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  imageQualityLabelKey,
  imageSizeLabel,
} from '@/features/playground/lib/studio/generation-options'
import {
  isPlaygroundImageModel,
  normalizeImageGenerationSettings,
  PLAYGROUND_IMAGE_MODEL,
} from '@/features/playground/lib/studio/image-request-schema'
import type { StudioSettings } from '@/features/playground/types'
import { usePlaygroundStore } from '@/stores/playground-store'

import { SettingRow } from './setting-row'

/** Image parameters (OpenAI Images schema: quality/size/n). */
export function ImageSettings() {
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

  const allowed = isPlaygroundImageModel(model)
  const normalized = normalizeImageGenerationSettings(settings)

  return (
    <div className='space-y-3'>
      {!allowed && (
        <p className='border-destructive/30 bg-destructive/5 text-destructive text-2xs rounded-lg border px-2.5 py-2 text-pretty'>
          {t(
            'Playground image generation uses GPT-format models only (gpt-image-2 or grok-imagine-image). Select one and try again.'
          )}
        </p>
      )}
      {allowed && (
        <p className='border-border bg-muted/40 text-muted-foreground text-2xs rounded-lg border px-2.5 py-2 text-pretty'>
          {t('Image model')}: {model || PLAYGROUND_IMAGE_MODEL}
        </p>
      )}
      <SettingRow label={t('Images per prompt')} htmlFor='gen-image-count'>
        <NativeSelect
          id='gen-image-count'
          size='sm'
          className='w-full'
          value={String(normalized.imageCount)}
          onChange={(event) => update('imageCount', Number(event.target.value))}
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
          checked={settings.imageBatchMode}
          onCheckedChange={(checked) => update('imageBatchMode', checked)}
        />
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
