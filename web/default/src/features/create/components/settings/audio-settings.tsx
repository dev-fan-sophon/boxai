import { useTranslation } from 'react-i18next'

import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  AUDIO_FORMATS,
  SPEEDS,
  VOICES,
} from '@/features/playground/lib/studio/generation-options'
import type { StudioSettings } from '@/features/playground/types'
import { usePlaygroundStore } from '@/stores/playground-store'

import { SettingRow } from './setting-row'

/** Speech parameters. */
export function AudioSettings() {
  const { t } = useTranslation()
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )

  const update = <K extends keyof StudioSettings>(
    key: K,
    value: StudioSettings[K]
  ) => setStudioSettings((prev) => ({ ...prev, [key]: value }))

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
