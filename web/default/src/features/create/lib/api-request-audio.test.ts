import { describe, expect, it } from 'vitest'

import { DEFAULT_STUDIO_SETTINGS } from '@/features/playground/lib/storage/store-migration'
import type { StudioSettings } from '@/features/playground/types'

import { buildApiRequest } from './api-request'

function audioRequest(
  settings: Partial<StudioSettings>,
  native = true,
  model = 'eleven_v3'
) {
  return buildApiRequest({
    modality: 'audio',
    model,
    prompt: 'Xin chào',
    settings: { ...DEFAULT_STUDIO_SETTINGS, ...settings },
    draft: {
      videoOptions: undefined,
      estimateParams: { modality: 'audio', n: 1, has_reference: false },
      audio: {
        tool: settings.audioTool ?? 'speech',
        model,
        modelKind: settings.audioTool ?? 'speech',
        native,
        usesFile: false,
        label: '',
      },
    },
  })
}

describe('buildApiRequest (audio)', () => {
  it('uses the native ElevenLabs text-to-speech call for ElevenLabs models', () => {
    const request = audioRequest({
      elevenVoiceId: 'pFZP5JQG7iQjIQuC4Bku',
      elevenSpeed: 1.1,
      elevenLanguage: 'vi',
    })
    expect(request.path).toBe(
      '/elevenlabs/v1/text-to-speech/pFZP5JQG7iQjIQuC4Bku?output_format=mp3_44100_128'
    )
    expect(request.body).toMatchObject({
      text: 'Xin chào',
      model_id: 'eleven_v3',
      language_code: 'vi',
      voice_settings: { speed: 1.1 },
    })
    expect(request.binaryOutput).toBe(true)
  })

  it.each([
    [
      'sfx',
      '/elevenlabs/v1/sound-generation?output_format=mp3_44100_128',
      undefined,
    ],
    ['music', '/elevenlabs/v1/music?output_format=mp3_44100_128', undefined],
    ['transcribe', '/elevenlabs/v1/speech-to-text', 'file'],
    ['isolate', '/elevenlabs/v1/audio-isolation', 'audio'],
    ['align', '/elevenlabs/v1/forced-alignment', 'file'],
  ] as const)('%s → %s', (tool, path, fileField) => {
    const request = audioRequest({ audioTool: tool })
    expect(request.path).toBe(path)
    expect(request.file?.field).toBe(fileField)
  })

  it('sends music length in milliseconds and omits it when automatic', () => {
    expect(
      audioRequest({ audioTool: 'music', musicLengthSeconds: 90 }).body
    ).toMatchObject({ music_length_ms: 90_000 })
    expect(
      audioRequest({ audioTool: 'music', musicLengthSeconds: null }).body
    ).not.toHaveProperty('music_length_ms')
  })

  it('keeps the OpenAI-compatible speech call for other speech models', () => {
    const request = audioRequest({ voice: 'nova' }, false, 'tts-1')
    expect(request.path).toBe('/v1/audio/speech')
    expect(request.body).toMatchObject({ model: 'tts-1', voice: 'nova' })
  })
})
