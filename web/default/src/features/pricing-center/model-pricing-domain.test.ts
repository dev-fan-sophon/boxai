import { describe, expect, it } from 'vitest'

import {
  applyOfficialPricePercent,
  editorToPricing,
  filterPricingModels,
  mergeReferenceResolution,
  pricingRecordToEditor,
  resolveSelectedModelName,
  stripLockedCompletionRatio,
  type PricingModelRecord,
} from './model-pricing-domain'

const officialReference = {
  model_name: 'gpt-test',
  provider: 'openai',
  input_price: 5,
  output_price: 20,
  cache_read_price: 1,
  model_ratio: 2.5,
  completion_ratio: 4,
  cache_ratio: 0.2,
}

const sampleModels: PricingModelRecord[] = [
  {
    model_name: 'gpt-4o',
    has_channel: true,
    configured: true,
    completion_ratio_locked: false,
    pricing: { mode: 'per-token', model_ratio: 1.25, completion_ratio: 2 },
  },
  {
    model_name: 'claude-sonnet',
    has_channel: true,
    configured: false,
    completion_ratio_locked: true,
    pricing: { mode: 'unset' },
  },
  {
    model_name: 'gemini-pro',
    has_channel: true,
    configured: true,
    completion_ratio_locked: false,
    pricing: { mode: 'per-request', model_price: 0 },
  },
]

describe('editorToPricing', () => {
  it('preserves explicit zero prices', () => {
    expect(
      editorToPricing({
        name: 'free-model',
        billingMode: 'per-token',
        ratio: '0',
        completionRatio: '0',
      })
    ).toEqual({
      mode: 'per-token',
      model_ratio: 0,
      completion_ratio: 0,
    })
  })

  it('combines tiered expression with request rules on save', () => {
    expect(
      editorToPricing({
        name: 'tiered',
        billingMode: 'tiered_expr',
        billingExpr: 'tier("base", p * 1 + c * 2)',
        requestRuleExpr: '(param("x") == "1" ? 1.5 : 1)',
      })
    ).toEqual({
      mode: 'tiered_expr',
      billing_expr:
        '(tier("base", p * 1 + c * 2)) * (param("x") == "1" ? 1.5 : 1)',
    })
  })
})

describe('pricingRecordToEditor', () => {
  it('maps unset records to a default per-token editor draft', () => {
    expect(
      pricingRecordToEditor({
        model_name: 'new-model',
        has_channel: true,
        configured: false,
        completion_ratio_locked: false,
        pricing: { mode: 'unset' },
      })
    ).toMatchObject({
      name: 'new-model',
      billingMode: 'per-token',
      completionRatioLocked: false,
    })
  })

  it('splits tiered billing expressions for the editor', () => {
    expect(
      pricingRecordToEditor({
        model_name: 'tiered',
        has_channel: true,
        configured: true,
        completion_ratio_locked: false,
        pricing: {
          mode: 'tiered_expr',
          billing_expr:
            '(tier("base", p * 1 + c * 2)) * (param("x") == "1" ? 1.5 : 1)',
        },
      })
    ).toMatchObject({
      billingMode: 'tiered_expr',
      billingExpr: 'tier("base", p * 1 + c * 2)',
      requestRuleExpr: '(param("x") == "1" ? 1.5 : 1)',
    })
  })

  it('preserves explicit zero per-request price', () => {
    expect(
      pricingRecordToEditor({
        model_name: 'free',
        has_channel: true,
        configured: true,
        completion_ratio_locked: false,
        pricing: { mode: 'per-request', model_price: 0 },
      })
    ).toMatchObject({
      billingMode: 'per-request',
      price: '0',
    })
  })
})

describe('stripLockedCompletionRatio', () => {
  it('removes completion_ratio only when locked', () => {
    expect(
      stripLockedCompletionRatio(
        { mode: 'per-token', model_ratio: 1, completion_ratio: 3 },
        true
      )
    ).toEqual({ mode: 'per-token', model_ratio: 1 })
    expect(
      stripLockedCompletionRatio(
        { mode: 'per-token', model_ratio: 1, completion_ratio: 3 },
        false
      )
    ).toEqual({ mode: 'per-token', model_ratio: 1, completion_ratio: 3 })
  })
})

describe('official price discount', () => {
  it('discounts the base price while preserving relative lane ratios', () => {
    expect(
      applyOfficialPricePercent(
        {
          mode: 'per-token',
          model_ratio: 1,
          completion_ratio: 2,
          create_cache_ratio: 1.25,
        },
        officialReference,
        80
      )
    ).toEqual({
      mode: 'per-token',
      official_price_percent: 80,
      model_ratio: 2,
      completion_ratio: 4,
      cache_ratio: 0.2,
      create_cache_ratio: 1.25,
    })
  })

  it('rejects incompatible modes and unsafe percentages', () => {
    expect(
      applyOfficialPricePercent(
        { mode: 'unset' },
        {
          ...officialReference,
          quick_discount_supported: false,
          rates: [{ category: 'video_output', unit: 'second', price: 0.14 }],
        },
        50
      )
    ).toBeNull()
    expect(
      applyOfficialPricePercent(
        { mode: 'unset' },
        {
          model_name: 'audio',
          provider: 'elevenlabs',
          rates: [
            { category: 'speech', unit: 'thousand_characters', price: 0.08 },
          ],
        },
        50
      )
    ).toBeNull()
    expect(
      applyOfficialPricePercent(
        { mode: 'per-request', model_price: 0.01 },
        officialReference,
        50
      )
    ).toBeNull()
    expect(
      applyOfficialPricePercent({ mode: 'unset' }, officialReference, 0)
    ).toBeNull()
    expect(
      applyOfficialPricePercent({ mode: 'unset' }, officialReference, 0.99)
    ).toBeNull()
    expect(
      applyOfficialPricePercent({ mode: 'unset' }, officialReference, 101)
    ).toBeNull()
    expect(
      applyOfficialPricePercent({ mode: 'unset' }, officialReference, 1)
    ).toMatchObject({ model_ratio: 0.025 })
    expect(
      applyOfficialPricePercent({ mode: 'unset' }, officialReference, 100)
    ).toMatchObject({ model_ratio: 2.5 })
  })

  it('persists only the entered percentage and rejects unsupported precision', () => {
    expect(
      applyOfficialPricePercent(
        { mode: 'per-token', model_ratio: 0.505, official_price_percent: 20 },
        officialReference,
        34.75
      )
    ).toMatchObject({ official_price_percent: 34.75 })
    expect(
      applyOfficialPricePercent(
        { mode: 'per-token', model_ratio: 2 },
        officialReference,
        15.936
      )
    ).toBeNull()
  })
})

describe('filterPricingModels', () => {
  it('filters by configured status and case-insensitive name search', () => {
    expect(
      filterPricingModels(sampleModels, {
        status: 'unconfigured',
      }).map((model) => model.model_name)
    ).toEqual(['claude-sonnet'])

    expect(
      filterPricingModels(sampleModels, {
        status: 'configured',
        search: 'GPT',
      }).map((model) => model.model_name)
    ).toEqual(['gpt-4o'])
  })
})

describe('resolveSelectedModelName', () => {
  it('keeps the current selection when it remains visible', () => {
    expect(resolveSelectedModelName(sampleModels, 'gemini-pro', 'gpt-4o')).toBe(
      'gemini-pro'
    )
  })

  it('falls back to preferred then first visible model', () => {
    const unconfigured = filterPricingModels(sampleModels, {
      status: 'unconfigured',
    })
    expect(resolveSelectedModelName(unconfigured, 'gpt-4o', null)).toBe(
      'claude-sonnet'
    )
    expect(
      resolveSelectedModelName(unconfigured, 'gpt-4o', 'claude-sonnet')
    ).toBe('claude-sonnet')
    expect(resolveSelectedModelName([], 'gpt-4o', 'gpt-4o')).toBeNull()
  })
})

describe('mergeReferenceResolution', () => {
  it('rejects dependent token prices without a base model ratio', () => {
    expect(
      mergeReferenceResolution({ mode: 'unset' }, { completion_ratio: 2 })
    ).toBeNull()
  })

  it('preserves an existing per-token base when adopting dependent prices', () => {
    expect(
      mergeReferenceResolution(
        { mode: 'per-token', model_ratio: 1 },
        { completion_ratio: 2 }
      )
    ).toEqual({
      mode: 'per-token',
      model_ratio: 1,
      completion_ratio: 2,
    })
  })

  it('normalizes the legacy ratio billing mode', () => {
    expect(
      mergeReferenceResolution(
        { mode: 'unset' },
        { billing_mode: 'ratio', model_ratio: 0 }
      )
    ).toEqual({ mode: 'per-token', model_ratio: 0 })
  })

  it('rejects a tiered mode without an expression', () => {
    expect(
      mergeReferenceResolution(
        { mode: 'unset' },
        { billing_mode: 'tiered_expr' }
      )
    ).toBeNull()
  })
})
