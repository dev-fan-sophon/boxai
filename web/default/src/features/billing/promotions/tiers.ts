import type { Promotion, PromotionTier } from './api'

/**
 * Tiers the current user can still earn right now. Mirrors the server's
 * eligibility checks so the top-up page never advertises a refused discount.
 */
export function eligiblePromotionTiers(
  promotion: Promotion | undefined,
  nowSeconds: number
): PromotionTier[] {
  if (
    !promotion?.enabled ||
    promotion.starts_at > nowSeconds ||
    (promotion.ends_at > 0 && promotion.ends_at <= nowSeconds) ||
    promotion.remaining_uses === 0 ||
    promotion.budget_exhausted
  ) {
    return []
  }
  return promotion.tiers ?? []
}

/**
 * Same rule as the server quote: floor the percentage, apply the tier cap,
 * and keep the best eligible tier (ties go to the higher threshold).
 */
export function bestPromotionTier(
  tiers: PromotionTier[],
  face: number
): { tier: PromotionTier; discount: number } | null {
  let best: { tier: PromotionTier; discount: number } | null = null
  for (const tier of tiers) {
    if (face < tier.min_amount) continue
    let discount = Math.floor((face * tier.percent_off) / 100)
    if (tier.max_discount > 0) discount = Math.min(discount, tier.max_discount)
    if (discount > 0 && (!best || discount >= best.discount)) {
      best = { tier, discount }
    }
  }
  return best
}

/** The closest higher-percentage tier above the face amount, if any. */
export function nextPromotionTier(
  tiers: PromotionTier[],
  face: number
): { tier: PromotionTier; missing: number } | null {
  const current = bestPromotionTier(tiers, face)?.tier.percent_off ?? 0
  const next = tiers.find(
    (tier) => tier.min_amount > face && tier.percent_off > current
  )
  return next ? { tier: next, missing: next.min_amount - face } : null
}
