import { useTranslation } from 'react-i18next'

import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  DEFAULT_AUDIO_STUDIO_SETTINGS,
  MUSIC_LENGTH_RANGE,
  SFX_DURATION_RANGE,
  STT_SPEAKERS_RANGE,
} from '@/features/playground/lib/studio/audio-settings'
import { usePlaygroundStore } from '@/stores/playground-store'

import { useStudioSettingUpdater } from '../../hooks/use-studio-setting-updater'
import { formatClock } from '../../lib/transcript'
import {
  LanguageSelect,
  OutputFormatSelect,
  SliderRow,
  SwitchRow,
} from './audio-controls'
import { SeedInput } from './audio-speech-settings'
import { ElevenVoicePicker } from './eleven-voice-picker'
import { SettingRow } from './setting-row'

/** Sound effects: length (auto or 0.5–30 s), prompt influence, loop. */
export function SoundEffectSettings() {
  const { t } = useTranslation()
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const update = useStudioSettingUpdater()
  const duration = settings.sfxDuration

  return (
    <div className='space-y-4'>
      <SwitchRow
        label={t('Automatic length')}
        hint={t('Let the model choose the best duration.')}
        checked={duration === null}
        onChange={(checked) => update('sfxDuration', checked ? null : 5)}
      />
      {duration !== null && (
        <SliderRow
          id='gen-sfx-duration'
          label={t('Duration (seconds)')}
          value={duration}
          min={SFX_DURATION_RANGE.min}
          max={SFX_DURATION_RANGE.max}
          step={SFX_DURATION_RANGE.step}
          valueLabel={`${duration.toFixed(1)} s`}
          onChange={(value) => update('sfxDuration', value)}
        />
      )}
      <SliderRow
        id='gen-sfx-influence'
        label={t('Prompt influence')}
        value={settings.sfxPromptInfluence}
        min={0}
        max={1}
        step={0.05}
        valueLabel={`${Math.round(settings.sfxPromptInfluence * 100)}%`}
        hint={t('Higher follows the prompt more literally.')}
        onChange={(value) => update('sfxPromptInfluence', value)}
      />
      <SwitchRow
        label={t('Seamless loop')}
        checked={settings.sfxLoop}
        onChange={(checked) => update('sfxLoop', checked)}
      />
      <SettingRow label={t('Output format')} htmlFor='gen-sfx-format'>
        <OutputFormatSelect
          id='gen-sfx-format'
          value={settings.elevenOutputFormat}
          onChange={(value) => update('elevenOutputFormat', value)}
        />
      </SettingRow>
    </div>
  )
}

/** Music: length (auto or 3 s – 10 min) and instrumental only. */
export function MusicSettings() {
  const { t } = useTranslation()
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const update = useStudioSettingUpdater()
  const length = settings.musicLengthSeconds

  return (
    <div className='space-y-4'>
      <SwitchRow
        label={t('Automatic length')}
        hint={t('Let the model choose the song length.')}
        checked={length === null}
        onChange={(checked) =>
          update(
            'musicLengthSeconds',
            checked ? null : DEFAULT_AUDIO_STUDIO_SETTINGS.musicLengthSeconds
          )
        }
      />
      {length !== null && (
        <SliderRow
          id='gen-music-length'
          label={t('Length')}
          value={length}
          min={MUSIC_LENGTH_RANGE.min}
          max={MUSIC_LENGTH_RANGE.max}
          step={length < 60 ? 1 : 5}
          valueLabel={formatClock(length)}
          hint={t('Billed by the requested length.')}
          onChange={(value) => update('musicLengthSeconds', Math.round(value))}
        />
      )}
      <SwitchRow
        label={t('Instrumental only')}
        hint={t('No vocals, even if the prompt mentions lyrics.')}
        checked={settings.musicInstrumental}
        onChange={(checked) => update('musicInstrumental', checked)}
      />
    </div>
  )
}

/** Speech-to-text: language, speakers, timestamps, audio events. */
export function TranscribeSettings() {
  const { t } = useTranslation()
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const update = useStudioSettingUpdater()

  return (
    <div className='space-y-4'>
      <SettingRow label={t('Language')} htmlFor='gen-stt-language'>
        <LanguageSelect
          id='gen-stt-language'
          value={settings.sttLanguage}
          autoLabel={t('Detect automatically')}
          onChange={(value) => update('sttLanguage', value)}
        />
      </SettingRow>
      <SwitchRow
        label={t('Identify speakers')}
        hint={t('Label who is speaking on each line.')}
        checked={settings.sttDiarize}
        onChange={(checked) => update('sttDiarize', checked)}
      />
      {settings.sttDiarize && (
        <SettingRow label={t('Number of speakers')} htmlFor='gen-stt-speakers'>
          <NativeSelect
            id='gen-stt-speakers'
            size='sm'
            className='w-full'
            value={String(settings.sttNumSpeakers ?? '')}
            onChange={(event) =>
              update(
                'sttNumSpeakers',
                event.target.value ? Number(event.target.value) : null
              )
            }
          >
            <NativeSelectOption value=''>
              {t('Detect automatically')}
            </NativeSelectOption>
            {Array.from(
              { length: STT_SPEAKERS_RANGE.max },
              (_, index) => index + 1
            ).map((count) => (
              <NativeSelectOption key={count} value={String(count)}>
                {count}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </SettingRow>
      )}
      <SwitchRow
        label={t('Timestamps')}
        hint={t('Time each line so you can export subtitles (.srt).')}
        checked={settings.sttTimestamps === 'word'}
        onChange={(checked) =>
          update('sttTimestamps', checked ? 'word' : 'none')
        }
      />
      <SwitchRow
        label={t('Tag audio events')}
        hint={t('Mark laughter, applause, music and other sounds.')}
        checked={settings.sttTagAudioEvents}
        onChange={(checked) => update('sttTagAudioEvents', checked)}
      />
    </div>
  )
}

/** Speech-to-speech: target voice and noise removal. */
export function VoiceChangerSettings() {
  const { t } = useTranslation()
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const update = useStudioSettingUpdater()

  return (
    <div className='space-y-4'>
      <SettingRow label={t('Target voice')} htmlFor='gen-sts-voice'>
        <ElevenVoicePicker id='gen-sts-voice' />
      </SettingRow>
      <SwitchRow
        label={t('Remove background noise')}
        checked={settings.stsRemoveNoise}
        onChange={(checked) => update('stsRemoveNoise', checked)}
      />
      <SeedInput />
      <SettingRow label={t('Output format')} htmlFor='gen-sts-format'>
        <OutputFormatSelect
          id='gen-sts-format'
          value={settings.elevenOutputFormat}
          onChange={(value) => update('elevenOutputFormat', value)}
        />
      </SettingRow>
    </div>
  )
}
