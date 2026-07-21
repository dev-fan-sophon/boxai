/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { describe, expect, it } from 'vitest'

import type { PricingModel } from '../types'
import { getModelModality } from '../../playground/lib/studio/model-modality'
import { canTryInPlayground } from './playground-eligibility'

const model = { model_name: 'test' } as PricingModel

describe('canTryInPlayground', () => {
  it('allows supported legacy chat and verified playground operations', () => {
    expect(
      canTryInPlayground({
        ...model,
        integrations: [
          {
            profile_id: 'openai.audio.speech',
            groups: ['default'],
            verified: true,
            source: 'explicit',
          },
        ],
      })
    ).toBe(true)
  })

  it('rejects unsupported, inferred, and Responses-only models', () => {
    expect(
      canTryInPlayground({ ...model, supported_endpoint_types: ['openai'] })
    ).toBe(false)
    for (const profile_id of [
      'openai.embeddings',
      'jina.rerank',
      'openai.audio.transcriptions',
      'openai.realtime',
      'openai.responses',
    ]) {
      expect(
        canTryInPlayground({
          ...model,
          integrations: [
            {
              profile_id,
              groups: ['default'],
              verified: true,
              source: 'explicit',
            },
          ],
        })
      ).toBe(false)
    }
    expect(
      canTryInPlayground({
        ...model,
        integrations: [
          {
            profile_id: 'openai.video.create',
            groups: ['default'],
            verified: false,
            source: 'inferred',
          },
        ],
      })
    ).toBe(false)
  })
})

describe('getModelModality', () => {
  it('prefers an explicit Chat assignment over conflicting metadata and naming', () => {
    expect(
      getModelModality({
        model_name: 'image-generator',
        output_modalities: ['image'],
        integrations: [
          {
            profile_id: 'openai.chat_completions',
            groups: ['default'],
            verified: true,
            source: 'explicit',
          },
        ],
      })
    ).toBe('chat')
  })
})
