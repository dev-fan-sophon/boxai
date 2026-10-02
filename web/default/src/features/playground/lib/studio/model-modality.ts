import type { PricingModel } from '@/features/pricing/types'

import type { StudioModality } from '../../types'
import {
  isGeminiImageModel,
  isPlaygroundImageModel,
} from './image-request-schema'

type ModelModalityMetadata = Pick<PricingModel, 'model_name'> &
  Partial<
    Pick<
      PricingModel,
      'supported_endpoint_types' | 'output_modalities' | 'integrations' | 'tags'
    >
  >

export function getModelModality(model: ModelModalityMetadata): StudioModality {
  // Gemini image models also answer chat, but image output is their purpose;
  // they live in the image studio where aspect/resolution/references apply.
  if (isGeminiImageModel(model.model_name)) return 'image'
  const endpoints = model.supported_endpoint_types ?? []
  const output = model.output_modalities ?? []
  const tags = model.tags?.toLowerCase() ?? ''
  const profiles = new Set(
    (model.integrations ?? [])
      .filter(
        (integration) =>
          integration.verified && integration.source === 'explicit'
      )
      .map((integration) => integration.profile_id)
  )
  const hasExplicitPlaygroundProfile = [
    'openai.chat_completions',
    'openai.images.generate',
    'openai.video.create',
    'openai.audio.speech',
  ].some((profile) => profiles.has(profile))
  if (hasExplicitPlaygroundProfile) {
    if (profiles.has('openai.video.create')) return 'video'
    // Image profile maps to image only for GPT-format playground models.
    if (
      profiles.has('openai.images.generate') &&
      isPlaygroundImageModel(model.model_name)
    ) {
      return 'image'
    }
    if (profiles.has('openai.audio.speech')) return 'audio'
    return 'chat'
  }
  if (
    output.includes('video') ||
    endpoints.some((item) => item.includes('video')) ||
    /\boutput:video\b/.test(tags)
  ) {
    return 'video'
  }
  // Metadata image tags alone are not enough — only GPT-format image models.
  if (isPlaygroundImageModel(model.model_name)) {
    return 'image'
  }
  if (
    output.includes('audio') ||
    endpoints.some(
      (item) => item.includes('audio') || item.includes('speech')
    ) ||
    /\boutput:audio\b/.test(tags)
  ) {
    return 'audio'
  }
  if (output.length || endpoints.length) return 'chat'
  const name = model.model_name.toLowerCase()
  if (
    /sora|veo|video|kling|runway|seedance|hailuo|vidu|luma|pixverse/.test(name)
  ) {
    return 'video'
  }
  if (isPlaygroundImageModel(name)) {
    return 'image'
  }
  if (/tts|speech|audio|voice/.test(name)) return 'audio'
  if (ELEVENLABS_MODEL_KINDS[model.model_name]) return 'audio'
  return 'chat'
}

/**
 * Audio sub-tool a model serves. ElevenLabs models advertise it through
 * their gateway endpoint type (`audio-tts`, `audio-sfx`, …); other audio
 * models (OpenAI-compatible TTS) are speech models.
 */
export type AudioKind =
  | 'speech'
  | 'sfx'
  | 'music'
  | 'transcribe'
  | 'voice-changer'
  | 'isolate'
  | 'align'

const AUDIO_ENDPOINT_KINDS: Record<string, AudioKind> = {
  'audio-tts': 'speech',
  'audio-sfx': 'sfx',
  'audio-music': 'music',
  'audio-stt': 'transcribe',
  'audio-speech-to-speech': 'voice-changer',
  'audio-isolation': 'isolate',
  'audio-alignment': 'align',
}

/** Known ElevenLabs model ids, for catalogs without endpoint metadata. */
const ELEVENLABS_MODEL_KINDS: Record<string, AudioKind> = {
  eleven_v3: 'speech',
  eleven_multilingual_v2: 'speech',
  eleven_flash_v2_5: 'speech',
  eleven_turbo_v2_5: 'speech',
  eleven_text_to_sound_v2: 'sfx',
  music_v1: 'music',
  music_v2: 'music',
  scribe_v1: 'transcribe',
  scribe_v2: 'transcribe',
  eleven_multilingual_sts_v2: 'voice-changer',
  eleven_english_sts_v2: 'voice-changer',
  'elevenlabs-audio-isolation': 'isolate',
  'elevenlabs-forced-alignment': 'align',
}

function elevenLabsKind(model: ModelModalityMetadata): AudioKind | null {
  for (const endpoint of model.supported_endpoint_types ?? []) {
    const kind = AUDIO_ENDPOINT_KINDS[endpoint]
    if (kind) return kind
  }
  return ELEVENLABS_MODEL_KINDS[model.model_name] ?? null
}

/** Audio sub-tool of a model; null when the model is not an audio model. */
export function getAudioKind(model: ModelModalityMetadata): AudioKind | null {
  if (getModelModality(model) !== 'audio') return null
  return elevenLabsKind(model) ?? 'speech'
}

/**
 * Whether the model runs on the native ElevenLabs passthrough
 * (`/pg/elevenlabs/...`) rather than the OpenAI-compatible speech route.
 */
export function isElevenLabsAudioModel(model: ModelModalityMetadata): boolean {
  return elevenLabsKind(model) !== null
}
