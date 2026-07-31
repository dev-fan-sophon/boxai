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
