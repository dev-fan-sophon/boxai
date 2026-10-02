import { useTranslation } from 'react-i18next'

import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  AUDIO_FORMATS,
  SPEEDS,
  VOICES,
} from '@/features/playground/lib/studio/generation-options'
import { usePlaygroundStore } from '@/stores/playground-store'

import { useAudioTool } from '../../hooks/use-audio-tool'
import { useStudioSettingUpdater } from '../../hooks/use-studio-setting-updater'
import { AudioSpeechSettings } from './audio-speech-settings'
import {
  MusicSettings,
  SoundEffectSettings,
  TranscribeSettings,
  VoiceChangerSettings,
} from './audio-tool-settings'
import { SettingRow } from './setting-row'

/** Parameters of the active audio sub-tool. */
export function AudioSettings() {
  const { t } = useTranslation()
  const audio = useAudioTool()

  if (!audio.native) return <OpenAISpeechSettings />
  switch (audio.tool) {
    case 'sfx':
      return <SoundEffectSettings />
    case 'music':
      return <MusicSettings />
    case 'transcribe':
      return <TranscribeSettings />
    case 'voice-changer':
      return <VoiceChangerSettings />
    case 'isolate':
      return (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Removes music, noise and room sound, keeping only the voice. No settings needed.'
          )}
        </p>
      )
    case 'align':
      return (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Times every word of your script against the audio, for subtitles and lip-sync.'
          )}
        </p>
      )
    default:
      return <AudioSpeechSettings model={audio.model} />
  }
}

/** OpenAI-compatible speech models (voice name, speed, container). */
function OpenAISpeechSettings() {
  const { t } = useTranslation()
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const update = useStudioSettingUpdater()

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
