/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { PricingModel } from '@/features/pricing/types'

import type { StudioModality } from '../../types'

export function getModelModality(model: PricingModel): StudioModality {
  const endpoints = model.supported_endpoint_types ?? []
  const output = model.output_modalities ?? []
  if (
    output.includes('video') ||
    endpoints.some((item) => item.includes('video'))
  ) {
    return 'video'
  }
  if (
    output.includes('image') ||
    endpoints.some((item) => item.includes('image'))
  ) {
    return 'image'
  }
  if (
    output.includes('audio') ||
    endpoints.some((item) => item.includes('audio') || item.includes('speech'))
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
