import type { PricingModel } from '@/features/pricing/types'
import { formatCurrencyFromUSD } from '@/lib/currency'

export type PriceHint = {
  kind: 'per_request' | 'token' | 'group' | 'unknown'
  /** Short label for chips, e.g. "⚡0.12 / run" or "Token billing" */
  labelKey: string
  /** Optional numeric fragment already formatted for display */
  amountLabel?: string
  groupRatio?: number
}

/**
 * Build a non-invented price hint from catalog ratios.
 * - quota_type 1 + model_price → per-request style (currency-formatted)
 * - otherwise token billing; include group ratio when available
 */
export function buildPriceHint(
  model: PricingModel | undefined,
  group: string,
  groupRatio?: number
): PriceHint {
  if (!model) {
    return { kind: 'unknown', labelKey: 'Token billing' }
  }

  const resolvedGroupRatio = groupRatio ?? model.group_ratio?.[group]

  // quota_type 1 is typically fixed / per-request pricing in this codebase
  if (model.quota_type === 1 && typeof model.model_price === 'number') {
    const amount = model.model_price * (resolvedGroupRatio ?? 1)
    if (Number.isFinite(amount) && amount > 0) {
      return {
        kind: 'per_request',
        labelKey: 'per run',
        amountLabel: formatCurrencyFromUSD(amount, {
          digitsLarge: 4,
          digitsSmall: 4,
          abbreviate: false,
        }),
        groupRatio: resolvedGroupRatio,
      }
    }
  }

  if (typeof model.model_ratio === 'number' && model.model_ratio > 0) {
    return {
      kind: 'token',
      labelKey: 'Token billing',
      amountLabel:
        resolvedGroupRatio && resolvedGroupRatio !== 1
          ? `×${formatRatioAmount(resolvedGroupRatio)}`
          : undefined,
      groupRatio: resolvedGroupRatio,
    }
  }

  if (resolvedGroupRatio && resolvedGroupRatio !== 1) {
    return {
      kind: 'group',
      labelKey: 'Group rate',
      amountLabel: `×${formatRatioAmount(resolvedGroupRatio)}`,
      groupRatio: resolvedGroupRatio,
    }
  }

  return { kind: 'token', labelKey: 'Token billing' }
}

function formatRatioAmount(value: number): string {
  if (value >= 100) return value.toFixed(0)
  if (value >= 10) return value.toFixed(1)
  if (value >= 1) return value.toFixed(2)
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
