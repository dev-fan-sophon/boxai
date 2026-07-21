/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
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
