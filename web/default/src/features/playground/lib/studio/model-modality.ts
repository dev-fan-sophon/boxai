/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { PricingModel } from '@/features/pricing/types'

import type { StudioModality } from '../../types'

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
    if (profiles.has('openai.images.generate')) return 'image'
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
  if (
    output.includes('image') ||
    endpoints.some((item) => item.includes('image')) ||
    /\boutput:image\b/.test(tags)
  ) {
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
  if (
    /dall|image|imagen|flux|midjourney|stable-diffusion|seedream|jimeng|nano-banana/.test(
      name
    )
  ) {
    return 'image'
  }
  if (/tts|speech|audio|voice/.test(name)) return 'audio'
  return 'chat'
}
