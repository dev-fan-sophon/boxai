import { describe, expect, it } from 'vitest'

import type { PricingModel } from '../types'
import { compareVendorNames, groupModelsByVendor } from './model-helpers'

function model(name: string, vendor?: string): PricingModel {
  return {
    model_name: name,
    vendor_name: vendor,
    model_ratio: 1,
    completion_ratio: 1,
    quota_type: 0,
  } as PricingModel
}

describe('groupModelsByVendor order', () => {
  it('puts OpenAI, Google, DeepSeek, Moonshot before Anthropic and Other', () => {
    const groups = groupModelsByVendor(
      [
        model('claude-sonnet-5', 'Anthropic'),
        model('mystery', undefined),
        model('glm-5.2', 'Zhipu AI'),
        model('gpt-5.6', 'OpenAI'),
        model('kimi-k2.6', 'Moonshot AI'),
        model('deepseek-v4-flash', 'DeepSeek'),
        model('gemini-3.5-flash', 'Google'),
        model('grok-4.5', 'xAI'),
      ],
      'Other'
    )

    expect(groups.map((g) => g.name)).toEqual([
      'OpenAI',
      'Google',
      'DeepSeek',
      'Moonshot AI',
      'xAI',
      'Zhipu AI',
      'Anthropic',
      'Other',
    ])
  })

  it('compareVendorNames matches hub section order for flat lists', () => {
    const names = [
      'Anthropic',
      'OpenAI',
      'DeepSeek',
      'Google',
      'Moonshot AI',
      '',
      'xAI',
    ]
    expect([...names].sort(compareVendorNames)).toEqual([
      'OpenAI',
      'Google',
      'DeepSeek',
      'Moonshot AI',
      'xAI',
      'Anthropic',
      '',
    ])
  })
})
