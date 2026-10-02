import type { AudioKind } from './model-modality'

/**
 * Audio studio parameters, one group per sub-tool. Ranges follow the
 * ElevenLabs API reference (https://elevenlabs.io/docs/api-reference) and are
 * enforced again by the gateway before billing.
 */
export type AudioStudioSettings = {
  /** Active audio sub-tool of /create/audio. */
  audioTool: AudioKind
  elevenVoiceId: string
  elevenVoiceName: string
  elevenStability: number
  elevenSimilarity: number
  elevenStyle: number
  elevenSpeakerBoost: boolean
  elevenSpeed: number
  /** ISO 639-1 code; empty = detect from the text. */
  elevenLanguage: string
  elevenSeed: number | null
  elevenOutputFormat: string
  /** Seconds; null = let the model pick the length. */
  sfxDuration: number | null
  sfxPromptInfluence: number
  sfxLoop: boolean
  /** Seconds; null = let the model pick the length. */
  musicLengthSeconds: number | null
  musicInstrumental: boolean
  /** ISO 639-1 code; empty = auto-detect. */
  sttLanguage: string
  sttDiarize: boolean
  /** null = detect the number of speakers. */
  sttNumSpeakers: number | null
  sttTimestamps: 'word' | 'none'
  sttTagAudioEvents: boolean
  stsRemoveNoise: boolean
}

export const AUDIO_TOOLS: AudioKind[] = [
  'speech',
  'sfx',
  'music',
  'transcribe',
  'voice-changer',
  'isolate',
  'align',
]

/** Sub-tools whose input is an uploaded audio/video file. */
export const FILE_AUDIO_TOOLS: ReadonlySet<AudioKind> = new Set([
  'transcribe',
  'voice-changer',
  'isolate',
  'align',
])

/** ElevenLabs default voice used until the user picks one. */
export const DEFAULT_ELEVEN_VOICE = {
  id: 'JBFqnCBsd6RMkjVDRZzb',
  name: 'George',
} as const

export const ELEVEN_TTS_CHAR_LIMITS: Record<string, number> = {
  eleven_v3: 5000,
  eleven_multilingual_v2: 10000,
}
export const ELEVEN_TTS_DEFAULT_CHAR_LIMIT = 40000

export function elevenTtsCharLimit(model: string): number {
  return ELEVEN_TTS_CHAR_LIMITS[model] ?? ELEVEN_TTS_DEFAULT_CHAR_LIMIT
}

export const ELEVEN_SPEED_RANGE = { min: 0.7, max: 1.2, step: 0.05 } as const
export const SFX_DURATION_RANGE = { min: 0.5, max: 30, step: 0.5 } as const
export const MUSIC_LENGTH_RANGE = { min: 3, max: 600, step: 1 } as const
export const STT_SPEAKERS_RANGE = { min: 1, max: 32 } as const
export const MAX_ELEVEN_SEED = 4294967295

/** eleven_v3 only accepts these stability presets. */
export const ELEVEN_V3_STABILITY = [
  { value: 0, labelKey: 'Creative' },
  { value: 0.5, labelKey: 'Natural' },
  { value: 1, labelKey: 'Robust' },
] as const

/** Browser-playable ElevenLabs `output_format` values. */
export const ELEVEN_OUTPUT_FORMATS = [
  'mp3_44100_128',
  'mp3_44100_192',
  'mp3_44100_64',
  'mp3_22050_32',
  'opus_48000_128',
  'opus_48000_64',
  'wav_44100',
  'wav_22050',
] as const

/** ISO 639-1 codes offered for speech and transcription (Vietnamese first). */
export const AUDIO_LANGUAGES = [
  'vi',
  'en',
  'zh',
  'ja',
  'ko',
  'th',
  'id',
  'fr',
  'de',
  'es',
  'pt',
  'it',
  'ru',
  'hi',
] as const

export const DEFAULT_AUDIO_STUDIO_SETTINGS: AudioStudioSettings = {
  audioTool: 'speech',
  elevenVoiceId: DEFAULT_ELEVEN_VOICE.id,
  elevenVoiceName: DEFAULT_ELEVEN_VOICE.name,
  elevenStability: 0.5,
  elevenSimilarity: 0.75,
  elevenStyle: 0,
  elevenSpeakerBoost: true,
  elevenSpeed: 1,
  elevenLanguage: '',
  elevenSeed: null,
  elevenOutputFormat: 'mp3_44100_128',
  sfxDuration: null,
  sfxPromptInfluence: 0.3,
  sfxLoop: false,
  musicLengthSeconds: 30,
  musicInstrumental: false,
  sttLanguage: '',
  sttDiarize: true,
  sttNumSpeakers: null,
  sttTimestamps: 'word',
  sttTagAudioEvents: true,
  stsRemoveNoise: false,
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function optionalClamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number | null
): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function languageCode(value: unknown): string {
  return typeof value === 'string' && /^[a-z]{2,3}$/.test(value) ? value : ''
}

/** Restores persisted audio settings, dropping unknown or out-of-range values. */
export function normalizeAudioStudioSettings(
  raw: Record<string, unknown>
): AudioStudioSettings {
  const defaults = DEFAULT_AUDIO_STUDIO_SETTINGS
  const voiceId =
    typeof raw.elevenVoiceId === 'string' &&
    /^[A-Za-z0-9]{10,64}$/.test(raw.elevenVoiceId)
      ? raw.elevenVoiceId
      : defaults.elevenVoiceId
  const seed = optionalClamp(raw.elevenSeed, 0, MAX_ELEVEN_SEED, null)
  const speakers = optionalClamp(
    raw.sttNumSpeakers,
    STT_SPEAKERS_RANGE.min,
    STT_SPEAKERS_RANGE.max,
    null
  )
  return {
    audioTool: oneOf(raw.audioTool, AUDIO_TOOLS, defaults.audioTool),
    elevenVoiceId: voiceId,
    elevenVoiceName:
      voiceId !== defaults.elevenVoiceId &&
      typeof raw.elevenVoiceName === 'string'
        ? raw.elevenVoiceName.slice(0, 120)
        : defaults.elevenVoiceName,
    elevenStability: clamp(raw.elevenStability, 0, 1, defaults.elevenStability),
    elevenSimilarity: clamp(
      raw.elevenSimilarity,
      0,
      1,
      defaults.elevenSimilarity
    ),
    elevenStyle: clamp(raw.elevenStyle, 0, 1, defaults.elevenStyle),
    elevenSpeakerBoost:
      typeof raw.elevenSpeakerBoost === 'boolean'
        ? raw.elevenSpeakerBoost
        : defaults.elevenSpeakerBoost,
    elevenSpeed: clamp(
      raw.elevenSpeed,
      ELEVEN_SPEED_RANGE.min,
      ELEVEN_SPEED_RANGE.max,
      defaults.elevenSpeed
    ),
    elevenLanguage: languageCode(raw.elevenLanguage),
    elevenSeed: seed === null ? null : Math.round(seed),
    elevenOutputFormat: oneOf(
      raw.elevenOutputFormat,
      ELEVEN_OUTPUT_FORMATS,
      'mp3_44100_128'
    ),
    sfxDuration: optionalClamp(
      raw.sfxDuration,
      SFX_DURATION_RANGE.min,
      SFX_DURATION_RANGE.max,
      defaults.sfxDuration
    ),
    sfxPromptInfluence: clamp(
      raw.sfxPromptInfluence,
      0,
      1,
      defaults.sfxPromptInfluence
    ),
    sfxLoop: raw.sfxLoop === true,
    musicLengthSeconds: optionalClamp(
      raw.musicLengthSeconds,
      MUSIC_LENGTH_RANGE.min,
      MUSIC_LENGTH_RANGE.max,
      defaults.musicLengthSeconds
    ),
    musicInstrumental: raw.musicInstrumental === true,
    sttLanguage: languageCode(raw.sttLanguage),
    sttDiarize:
      typeof raw.sttDiarize === 'boolean'
        ? raw.sttDiarize
        : defaults.sttDiarize,
    sttNumSpeakers: speakers === null ? null : Math.round(speakers),
    sttTimestamps: oneOf(
      raw.sttTimestamps,
      ['word', 'none'] as const,
      defaults.sttTimestamps
    ),
    sttTagAudioEvents:
      typeof raw.sttTagAudioEvents === 'boolean'
        ? raw.sttTagAudioEvents
        : defaults.sttTagAudioEvents,
    stsRemoveNoise: raw.stsRemoveNoise === true,
  }
}
