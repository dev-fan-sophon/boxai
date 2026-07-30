/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
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
  imageSizeLabel,
  videoSizeLabel,
} from '../../lib/studio/generation-options'
import {
  isPlaygroundImageModel,
  normalizeImageGenerationSettings,
  PLAYGROUND_IMAGE_MODEL,
} from '../../lib/studio/image-request-schema'
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
    return (
      <div className='space-y-3'>
        <SettingRow
          label={t('Duration (seconds)')}
          htmlFor='gen-video-duration'
        >
          <NativeSelect
            id='gen-video-duration'
            size='sm'
            className='w-full'
            value={String(settings.videoDuration)}
            onChange={(event) =>
              update('videoDuration', Number(event.target.value))
            }
          >
            {VIDEO_DURATIONS.map((duration) => (
              <NativeSelectOption key={duration} value={String(duration)}>
                {duration}s
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </SettingRow>
        <SettingRow label={t('Size')} htmlFor='gen-video-size'>
          <NativeSelect
            id='gen-video-size'
            size='sm'
            className='w-full'
            value={settings.videoSize}
            onChange={(event) => update('videoSize', event.target.value)}
          >
            {VIDEO_SIZES.map((size) => (
              <NativeSelectOption key={size} value={size}>
                {videoSizeLabel(size)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
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
