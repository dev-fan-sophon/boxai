import { useTranslation } from 'react-i18next'

import {
  AudioLines,
  Captions,
  Clock,
  Gauge,
  Languages,
  Mic,
  Piano,
  Repeat,
  Users,
  VolumeX,
} from '@/components/icons'
import { ParamChip } from '@/features/playground/components/composer/param-chip'
import { AUDIO_LANGUAGES } from '@/features/playground/lib/studio/audio-settings'
import {
  AUDIO_FORMATS,
  SPEEDS,
  VOICES,
} from '@/features/playground/lib/studio/generation-options'
import { usePlaygroundStore } from '@/stores/playground-store'

import { useAudioTool } from '../../hooks/use-audio-tool'
import { useStudioSettingUpdater } from '../../hooks/use-studio-setting-updater'
import { languageName, outputFormatLabel } from '../../lib/audio-format'
import { formatClock } from '../../lib/transcript'
import { ElevenVoicePicker } from '../settings/eleven-voice-picker'

const ELEVEN_SPEEDS = [0.7, 0.8, 0.9, 1, 1.1, 1.2]
const SFX_DURATIONS = [1, 2, 3, 5, 10, 15, 20, 30]
const MUSIC_LENGTHS = [15, 30, 60, 120, 180, 300, 600]
const AUTO = 'auto'

/** Inline parameters of the active audio sub-tool for the composer. */
export function AudioParamChips() {
  const { t, i18n } = useTranslation()
  const audio = useAudioTool()
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const update = useStudioSettingUpdater()
  const onOff = [
    { value: 'on', label: t('On') },
    { value: 'off', label: t('Off') },
  ]

  if (!audio.native) {
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

  if (audio.tool === 'speech') {
    return (
      <>
        <ElevenVoicePicker compact />
        <ParamChip
          icon={<Gauge />}
          ariaLabel={t('Speed')}
          valueLabel={`${settings.elevenSpeed}×`}
          value={String(settings.elevenSpeed)}
          onChange={(value) => update('elevenSpeed', Number(value))}
          options={ELEVEN_SPEEDS.map((speed) => ({
            value: String(speed),
            label: `${speed}×`,
          }))}
        />
        <ParamChip
          icon={<Languages />}
          ariaLabel={t('Language')}
          valueLabel={
            settings.elevenLanguage
              ? languageName(settings.elevenLanguage, i18n.language)
              : t('Auto')
          }
          value={settings.elevenLanguage || AUTO}
          onChange={(value) =>
            update('elevenLanguage', value === AUTO ? '' : value)
          }
          options={[
            { value: AUTO, label: t('Detect from text') },
            ...AUDIO_LANGUAGES.map((code) => ({
              value: code,
              label: languageName(code, i18n.language),
            })),
          ]}
        />
        <ParamChip
          icon={<AudioLines />}
          ariaLabel={t('Output format')}
          valueLabel={
            outputFormatLabel(settings.elevenOutputFormat).split(' · ')[0]
          }
          value={settings.elevenOutputFormat}
          onChange={(value) => update('elevenOutputFormat', value)}
          options={[
            'mp3_44100_128',
            'mp3_44100_192',
            'opus_48000_128',
            'wav_44100',
          ].map((format) => ({
            value: format,
            label: outputFormatLabel(format),
          }))}
        />
      </>
    )
  }

  if (audio.tool === 'sfx') {
    return (
      <>
        <ParamChip
          icon={<Clock />}
          ariaLabel={t('Duration (seconds)')}
          valueLabel={
            settings.sfxDuration === null
              ? t('Auto')
              : `${settings.sfxDuration}s`
          }
          value={
            settings.sfxDuration === null ? AUTO : String(settings.sfxDuration)
          }
          onChange={(value) =>
            update('sfxDuration', value === AUTO ? null : Number(value))
          }
          options={[
            { value: AUTO, label: t('Auto') },
            ...SFX_DURATIONS.map((seconds) => ({
              value: String(seconds),
              label: `${seconds}s`,
            })),
          ]}
        />
        <ParamChip
          icon={<Repeat />}
          ariaLabel={t('Seamless loop')}
          valueLabel={settings.sfxLoop ? t('Loop') : t('No loop')}
          value={settings.sfxLoop ? 'on' : 'off'}
          onChange={(value) => update('sfxLoop', value === 'on')}
          options={onOff}
        />
      </>
    )
  }

  if (audio.tool === 'music') {
    return (
      <>
        <ParamChip
          icon={<Clock />}
          ariaLabel={t('Length')}
          valueLabel={
            settings.musicLengthSeconds === null
              ? t('Auto')
              : formatClock(settings.musicLengthSeconds)
          }
          value={
            settings.musicLengthSeconds === null
              ? AUTO
              : String(settings.musicLengthSeconds)
          }
          onChange={(value) =>
            update('musicLengthSeconds', value === AUTO ? null : Number(value))
          }
          options={[
            { value: AUTO, label: t('Auto') },
            ...MUSIC_LENGTHS.map((seconds) => ({
              value: String(seconds),
              label: formatClock(seconds),
            })),
          ]}
        />
        <ParamChip
          icon={<Piano />}
          ariaLabel={t('Instrumental only')}
          valueLabel={
            settings.musicInstrumental ? t('Instrumental') : t('With vocals')
          }
          value={settings.musicInstrumental ? 'on' : 'off'}
          onChange={(value) => update('musicInstrumental', value === 'on')}
          options={[
            { value: 'off', label: t('With vocals') },
            { value: 'on', label: t('Instrumental') },
          ]}
        />
      </>
    )
  }

  if (audio.tool === 'transcribe') {
    return (
      <>
        <ParamChip
          icon={<Languages />}
          ariaLabel={t('Language')}
          valueLabel={
            settings.sttLanguage
              ? languageName(settings.sttLanguage, i18n.language)
              : t('Auto')
          }
          value={settings.sttLanguage || AUTO}
          onChange={(value) =>
            update('sttLanguage', value === AUTO ? '' : value)
          }
          options={[
            { value: AUTO, label: t('Detect automatically') },
            ...AUDIO_LANGUAGES.map((code) => ({
              value: code,
              label: languageName(code, i18n.language),
            })),
          ]}
        />
        <ParamChip
          icon={<Users />}
          ariaLabel={t('Identify speakers')}
          valueLabel={settings.sttDiarize ? t('Speakers') : t('No speakers')}
          value={settings.sttDiarize ? 'on' : 'off'}
          onChange={(value) => update('sttDiarize', value === 'on')}
          options={onOff}
        />
        <ParamChip
          icon={<Captions />}
          ariaLabel={t('Timestamps')}
          valueLabel={
            settings.sttTimestamps === 'word'
              ? t('Timestamps')
              : t('No timestamps')
          }
          value={settings.sttTimestamps === 'word' ? 'on' : 'off'}
          onChange={(value) =>
            update('sttTimestamps', value === 'on' ? 'word' : 'none')
          }
          options={onOff}
        />
      </>
    )
  }

  if (audio.tool === 'voice-changer') {
    return (
      <>
        <ElevenVoicePicker compact />
        <ParamChip
          icon={<VolumeX />}
          ariaLabel={t('Remove background noise')}
          valueLabel={
            settings.stsRemoveNoise ? t('Denoise') : t('Keep background')
          }
          value={settings.stsRemoveNoise ? 'on' : 'off'}
          onChange={(value) => update('stsRemoveNoise', value === 'on')}
          options={onOff}
        />
      </>
    )
  }

  return null
}
