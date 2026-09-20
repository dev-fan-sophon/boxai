import { describe, expect, it } from 'vitest'

import type { PricingModel } from '../types'
import { isPerSecondVideoModel } from './model-helpers'
import { requestPriceLabelKey, requestPriceUnitKey } from './price'

function model(name: string): PricingModel {
  return {
    id: 1,
    model_name: name,
    quota_type: 1,
    model_ratio: 0,
    completion_ratio: 0,
    model_price: 0.003,
    enable_groups: ['default'],
    group_ratio: { default: 1 },
  }
}

describe('per-second video catalog labels', () => {
  it.each([
    ['grok-imagine-video-1.5', true],
    ['grok-imagine-video', true],
    ['dreamina-seedance-2-5', true],
    ['seedance-2-0', true],
    ['grok-imagine-image-2.0', false],
    ['gpt-image-2', false],
  ] as const)('%s is per-second=%s', (name, expected) => {
    expect(isPerSecondVideoModel(model(name))).toBe(expected)
    expect(requestPriceLabelKey(model(name))).toBe(
      expected ? 'Per second' : 'Per request'
    )
    expect(requestPriceUnitKey(model(name))).toBe(
      expected ? 'second' : 'request'
    )
  })
})
