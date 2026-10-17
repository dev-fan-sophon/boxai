import { describe, expect, it } from 'vitest'

import type { Promotion } from './api'
import {
  bestPromotionTier,
  eligiblePromotionTiers,
  nextPromotionTier,
} from './tiers'

const ladder = [
  { min_amount: 100000, percent_off: 10, max_discount: 0 },
  { min_amount: 300000, percent_off: 15, max_discount: 0 },
  { min_amount: 500000, percent_off: 20, max_discount: 0 },
  { min_amount: 1000000, percent_off: 25, max_discount: 0 },
]

describe('promotion tiers', () => {
  it('matches the server quote at tier boundaries', () => {
    expect(bestPromotionTier(ladder, 99999)).toBeNull()
    expect(bestPromotionTier(ladder, 100000)?.discount).toBe(10000)
    expect(bestPromotionTier(ladder, 299999)?.discount).toBe(29999)
    expect(bestPromotionTier(ladder, 300000)?.tier.percent_off).toBe(15)
    expect(bestPromotionTier(ladder, 999999)?.discount).toBe(199999)
    expect(bestPromotionTier(ladder, 1000000)?.discount).toBe(250000)
  })

  it('keeps a lower tier when a capped higher tier is worth less', () => {
    const capped = [
      { min_amount: 100000, percent_off: 30, max_discount: 100000 },
      { min_amount: 300000, percent_off: 30, max_discount: 50000 },
    ]
    expect(bestPromotionTier(capped, 300000)).toEqual({
      tier: capped[0],
      discount: 90000,
    })
  })

  it('points to the next higher percentage', () => {
    expect(nextPromotionTier(ladder, 50000)).toEqual({
      tier: ladder[0],
      missing: 50000,
    })
    expect(nextPromotionTier(ladder, 450000)).toEqual({
      tier: ladder[2],
      missing: 50000,
    })
    expect(nextPromotionTier(ladder, 1000000)).toBeNull()
  })

  it('hides tiers the user can no longer earn', () => {
    const promotion = {
      enabled: true,
      starts_at: 0,
      ends_at: 0,
      tiers: ladder,
      remaining_uses: -1,
    } as Promotion
    expect(eligiblePromotionTiers(promotion, 10)).toBe(ladder)
    expect(
      eligiblePromotionTiers({ ...promotion, remaining_uses: 0 }, 10)
    ).toEqual([])
    expect(
      eligiblePromotionTiers({ ...promotion, budget_exhausted: true }, 10)
    ).toEqual([])
    expect(eligiblePromotionTiers({ ...promotion, ends_at: 10 }, 10)).toEqual(
      []
    )
  })
})
