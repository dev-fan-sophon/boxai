import { isAxiosError } from 'axios'

import type { AudioStudioSettings } from '@/features/playground/lib/studio/audio-settings'
import { api } from '@/lib/api'

import type { ElevenLabsTranscriptResponse } from './transcript'

/**
 * Audio studio calls. Every ElevenLabs tool goes through the session-auth
 * native passthrough `/pg/elevenlabs/<ElevenLabs path>`, which applies the
 * same endpoint allow-list, validation and billing as the public
 * `/elevenlabs/v1/...` API. The group travels in a header because
 * multipart bodies are forwarded untouched.
 */
export const PLAYGROUND_ELEVENLABS_BASE = '/pg/elevenlabs'

export type ElevenVoice = {
  voice_id: string
  name: string
  category?: string
  description?: string
  preview_url?: string
  labels?: Record<string, string>
}

export type ElevenVoicePage = {
  voices: ElevenVoice[]
  hasMore: boolean
  nextPageToken?: string
}

type AudioCall = { model: string; group: string }

function playgroundHeaders(group: string): Record<string, string> {
  return group ? { 'X-Playground-Group': group } : {}
}

/** Reads the provider/gateway message out of a failed (often Blob) response. */
async function audioRequestError(error: unknown): Promise<Error> {
  if (!isAxiosError(error)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  let payload: unknown = error.response?.data
  if (payload instanceof Blob) {
    const text = await payload.text()
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }
  if (typeof payload === 'string' && payload.trim()) {
    return new Error(payload.trim().slice(0, 500))
  }
  if (payload && typeof payload === 'object') {
    const record = payload as {
      error?: { message?: string }
      detail?: { message?: string } | string
      message?: string
    }
    const detail =
      typeof record.detail === 'string' ? record.detail : record.detail?.message
    const message = record.error?.message || detail || record.message
    if (message) return new Error(message)
  }
  return new Error(error.message || 'Request failed')
}

async function postForAudio(
  path: string,
  body: unknown,
  group: string,
  outputFormat?: string
): Promise<Blob> {
  try {
    const response = await api.post(
      `${PLAYGROUND_ELEVENLABS_BASE}${path}`,
      body,
      {
        params: outputFormat ? { output_format: outputFormat } : undefined,
        headers: playgroundHeaders(group),
        responseType: 'blob',
        skipErrorHandler: true,
      }
    )
    return response.data as Blob
  } catch (error) {
    throw await audioRequestError(error)
  }
}

export async function listElevenVoices(input: {
  group: string
  search?: string
  pageToken?: string
}): Promise<ElevenVoicePage> {
  try {
    const response = await api.get(`${PLAYGROUND_ELEVENLABS_BASE}/v2/voices`, {
      params: {
        page_size: 30,
        search: input.search?.trim() || undefined,
        next_page_token: input.pageToken || undefined,
        sort: input.search?.trim() ? undefined : 'name',
      },
      headers: playgroundHeaders(input.group),
      skipErrorHandler: true,
      disableDuplicate: true,
    })
    const data = response.data as {
      voices?: ElevenVoice[]
      has_more?: boolean
      next_page_token?: string | null
    }
    return {
      voices: data.voices ?? [],
      hasMore: data.has_more === true,
      nextPageToken: data.next_page_token ?? undefined,
    }
  } catch (error) {
    throw await audioRequestError(error)
  }
}

export function synthesizeSpeech(
  input: AudioCall & { text: string; settings: AudioStudioSettings }
): Promise<Blob> {
  const settings = input.settings
  return postForAudio(
    `/v1/text-to-speech/${encodeURIComponent(settings.elevenVoiceId)}`,
    {
      text: input.text,
      model_id: input.model,
      ...(settings.elevenLanguage
        ? { language_code: settings.elevenLanguage }
        : {}),
      ...(settings.elevenSeed !== null ? { seed: settings.elevenSeed } : {}),
      voice_settings: {
        stability: settings.elevenStability,
        similarity_boost: settings.elevenSimilarity,
        style: settings.elevenStyle,
        use_speaker_boost: settings.elevenSpeakerBoost,
        speed: settings.elevenSpeed,
      },
    },
    input.group,
    settings.elevenOutputFormat
  )
}

export function generateSoundEffect(
  input: AudioCall & { text: string; settings: AudioStudioSettings }
): Promise<Blob> {
  const settings = input.settings
  return postForAudio(
    '/v1/sound-generation',
    {
      text: input.text,
      model_id: input.model,
      prompt_influence: settings.sfxPromptInfluence,
      loop: settings.sfxLoop,
      ...(settings.sfxDuration !== null
        ? { duration_seconds: settings.sfxDuration }
        : {}),
    },
    input.group,
    settings.elevenOutputFormat
  )
}

export function composeMusic(
  input: AudioCall & { prompt: string; settings: AudioStudioSettings }
): Promise<Blob> {
  const settings = input.settings
  return postForAudio(
    '/v1/music',
    {
      prompt: input.prompt,
      model_id: input.model,
      force_instrumental: settings.musicInstrumental,
      ...(settings.musicLengthSeconds !== null
        ? { music_length_ms: Math.round(settings.musicLengthSeconds * 1000) }
        : {}),
    },
    input.group,
    settings.elevenOutputFormat.startsWith('mp3')
      ? settings.elevenOutputFormat
      : 'mp3_44100_128'
  )
}

export function changeVoice(
  input: AudioCall & { file: File; settings: AudioStudioSettings }
): Promise<Blob> {
  const settings = input.settings
  const form = new FormData()
  form.append('audio', input.file, input.file.name)
  form.append('model_id', input.model)
  form.append('remove_background_noise', String(settings.stsRemoveNoise))
  if (settings.elevenSeed !== null) {
    form.append('seed', String(settings.elevenSeed))
  }
  return postForAudio(
    `/v1/speech-to-speech/${encodeURIComponent(settings.elevenVoiceId)}`,
    form,
    input.group,
    settings.elevenOutputFormat
  )
}

export function isolateAudio(input: AudioCall & { file: File }): Promise<Blob> {
  const form = new FormData()
  form.append('audio', input.file, input.file.name)
  return postForAudio('/v1/audio-isolation', form, input.group)
}

export async function transcribeAudio(
  input: AudioCall & { file: File; settings: AudioStudioSettings }
): Promise<ElevenLabsTranscriptResponse> {
  const settings = input.settings
  const form = new FormData()
  form.append('model_id', input.model)
  form.append('file', input.file, input.file.name)
  if (settings.sttLanguage) form.append('language_code', settings.sttLanguage)
  form.append('diarize', String(settings.sttDiarize))
  if (settings.sttDiarize && settings.sttNumSpeakers !== null) {
    form.append('num_speakers', String(settings.sttNumSpeakers))
  }
  form.append('timestamps_granularity', settings.sttTimestamps)
  form.append('tag_audio_events', String(settings.sttTagAudioEvents))
  try {
    const response = await api.post(
      `${PLAYGROUND_ELEVENLABS_BASE}/v1/speech-to-text`,
      form,
      { headers: playgroundHeaders(input.group), skipErrorHandler: true }
    )
    return response.data as ElevenLabsTranscriptResponse
  } catch (error) {
    throw await audioRequestError(error)
  }
}

/** Forced alignment: word timings of a known script over an audio file. */
export async function alignAudio(
  input: AudioCall & { file: File; text: string }
): Promise<ElevenLabsTranscriptResponse> {
  const form = new FormData()
  form.append('file', input.file, input.file.name)
  form.append('text', input.text)
  try {
    const response = await api.post(
      `${PLAYGROUND_ELEVENLABS_BASE}/v1/forced-alignment`,
      form,
      { headers: playgroundHeaders(input.group), skipErrorHandler: true }
    )
    const data = response.data as {
      words?: Array<{ text: string; start: number; end: number }>
    }
    return {
      text: input.text,
      words: (data.words ?? []).flatMap((word, index) => [
        ...(index > 0 ? [{ text: ' ', type: 'spacing' }] : []),
        { ...word, type: 'word' },
      ]),
    }
  } catch (error) {
    throw await audioRequestError(error)
  }
}
