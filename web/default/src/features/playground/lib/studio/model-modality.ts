import type { PricingModel } from '@/features/pricing/types'

import type { StudioModality } from '../../types'
import { isPlaygroundImageModel } from './image-request-schema'

type ModelModalityMetadata = Pick<PricingModel, 'model_name'> &
  Partial<
    Pick<
      PricingModel,
      'supported_endpoint_types' | 'output_modalities' | 'integrations' | 'tags'
    >
  >

export function getModelModality(model: ModelModalityMetadata): StudioModality {
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
  return 'chat'
}
