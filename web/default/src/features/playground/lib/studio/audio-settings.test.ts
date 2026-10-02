import { describe, expect, it } from 'vitest'

import {
  DEFAULT_STUDIO_SETTINGS,
  normalizeStudioSettings,
} from '../storage/store-migration'
import { DEFAULT_ELEVEN_VOICE } from './audio-settings'
import { getAudioKind, getModelModality } from './model-modality'

describe('getAudioKind', () => {
  it.each([
    ['eleven_v3', ['audio-tts'], 'speech'],
    ['eleven_multilingual_sts_v2', ['audio-speech-to-speech'], 'voice-changer'],
    ['scribe_v2', ['audio-stt'], 'transcribe'],
    ['elevenlabs-audio-isolation', ['audio-isolation'], 'isolate'],
    ['eleven_text_to_sound_v2', ['audio-sfx'], 'sfx'],
    ['music_v2', ['audio-music'], 'music'],
    ['elevenlabs-forced-alignment', ['audio-alignment'], 'align'],
    ['tts-1', ['audio'], 'speech'],
  ])('%s → %s', (model, endpoints, kind) => {
    expect(
      getAudioKind({ model_name: model, supported_endpoint_types: endpoints })
    ).toBe(kind)
  })

  it('recognises ElevenLabs models without catalog metadata', () => {
    expect(getModelModality({ model_name: 'music_v2' })).toBe('audio')
    expect(getAudioKind({ model_name: 'scribe_v2' })).toBe('transcribe')
  })

  it('leaves non-audio models alone', () => {
    expect(getAudioKind({ model_name: 'gpt-5.4' })).toBeNull()
    expect(
      getAudioKind({
        model_name: 'veo-3',
        supported_endpoint_types: ['openai-video'],
      })
    ).toBeNull()
  })
})

describe('audio studio settings', () => {
  it('fills defaults for settings saved before the audio tools existed', () => {
    const restored = normalizeStudioSettings({ voice: 'nova', speed: 1.25 })
    expect(restored.voice).toBe('nova')
    expect(restored.audioTool).toBe('speech')
    expect(restored.elevenVoiceId).toBe(DEFAULT_ELEVEN_VOICE.id)
    expect(restored.elevenOutputFormat).toBe('mp3_44100_128')
    expect(restored.sfxDuration).toBeNull()
  })

  it('keeps a picked voice and clamps out-of-range values to the API limits', () => {
    const restored = normalizeStudioSettings({
      ...DEFAULT_STUDIO_SETTINGS,
      audioTool: 'music',
      elevenVoiceId: 'pFZP5JQG7iQjIQuC4Bku',
      elevenVoiceName: 'Lily',
      elevenSpeed: 2,
      sfxDuration: 99,
      musicLengthSeconds: 1,
      sttNumSpeakers: 50,
      elevenSeed: -4,
      elevenOutputFormat: 'pcm_16000',
    })
    expect(restored).toMatchObject({
      audioTool: 'music',
      elevenVoiceId: 'pFZP5JQG7iQjIQuC4Bku',
      elevenVoiceName: 'Lily',
      elevenSpeed: 1.2,
      sfxDuration: 30,
      musicLengthSeconds: 3,
      sttNumSpeakers: 32,
      elevenSeed: 0,
      elevenOutputFormat: 'mp3_44100_128',
    })
  })

  it('rejects a voice id that is not an ElevenLabs id', () => {
    const restored = normalizeStudioSettings({
      elevenVoiceId: '../v1/history',
      elevenVoiceName: 'x',
      audioTool: 'karaoke',
    })
    expect(restored.elevenVoiceId).toBe(DEFAULT_ELEVEN_VOICE.id)
    expect(restored.elevenVoiceName).toBe(DEFAULT_ELEVEN_VOICE.name)
    expect(restored.audioTool).toBe('speech')
  })
})
