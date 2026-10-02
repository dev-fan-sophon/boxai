import { AudioLines, Gauge, Mic } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ParamChip } from '@/features/playground/components/composer/param-chip'
import {
  AUDIO_FORMATS,
  SPEEDS,
  VOICES,
} from '@/features/playground/lib/studio/generation-options'
import type { StudioSettings } from '@/features/playground/types'
import { usePlaygroundStore } from '@/stores/playground-store'

/** Inline speech parameters for the composer. */
export function AudioParamChips() {
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
