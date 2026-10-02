import { getModelModality } from '@/features/playground/lib/studio/model-modality'

import type { PricingModel } from '../types'

const supportedExplicitProfiles = new Set([
  'openai.chat_completions',
  'openai.images.generate',
  'openai.video.create',
  'openai.audio.speech',
])

export function canTryInPlayground(model: PricingModel): boolean {
  return Boolean(
    model.integrations?.some(
      (integration) =>
        integration.verified &&
        integration.source === 'explicit' &&
        supportedExplicitProfiles.has(integration.profile_id)
    )
  )
}

/**
 * Chat needs an explicit integration profile. Media models are recognised by
 * their metadata instead (Gemini image, ElevenLabs, Seedance carry no
 * playground profile), so the creation studio and Model Hub "Try" accept
 * them whenever their modality is image, video or audio.
 */
export function canTryModel(model: PricingModel): boolean {
  return canTryInPlayground(model) || getModelModality(model) !== 'chat'
}
