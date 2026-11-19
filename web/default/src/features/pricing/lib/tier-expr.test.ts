import { describe, expect, it } from 'vitest'

import {
  CACHE_MODE_OPENAI_TTL,
  evalExprLocally,
  generateExprFromVisualConfig,
  getTierCacheMode,
  normalizeVisualTier,
} from './tier-expr'

const extras = {
  cacheReadTokens: 4000,
  cacheCreateTokens: 3000,
  cacheCreate1hTokens: 0,
  cacheCreate12hTokens: 4000,
  imageTokens: 0,
  imageOutputTokens: 0,
  audioInputTokens: 0,
  audioOutputTokens: 0,
}

describe('OpenAI 12h cache write pricing', () => {
  it('prices 12h writes with cc12h in the visual editor', () => {
    const tier = normalizeVisualTier({
      label: 'base',
      input_unit_cost: 10,
      output_unit_cost: 50,
      cache_create_unit_cost: 12.5,
      cache_create_12h_unit_cost: 25,
    })
    expect(getTierCacheMode(tier)).toBe(CACHE_MODE_OPENAI_TTL)
    expect(generateExprFromVisualConfig({ tiers: [tier] })).toBe(
      'tier("base", p * 10 + c * 50 + cc * 12.5 + cc12h * 25)'
    )
  })

  it('bills unpriced 12h writes at twice the cc price', () => {
    const priced = evalExprLocally(
      'tier("base", p * 10 + cr * 1 + cc * 12.5 + cc12h * 25)',
      1000,
      0,
      extras
    )
    const folded = evalExprLocally(
      'tier("base", p * 10 + cr * 1 + cc * 12.5)',
      1000,
      0,
      extras
    )
    expect(priced.cost).toBe(151500)
    expect(folded.cost).toBe(151500)
  })
})
