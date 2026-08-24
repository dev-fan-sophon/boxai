import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'

import type { RewardCampaign, RewardCampaignStatus } from './types'

export function campaignPublicStatus(
  campaign: RewardCampaign
): RewardCampaignStatus {
  if (campaign.status !== 1) return 'disabled'
  const now = Math.floor(Date.now() / 1000)
  if (campaign.starts_at > 0 && now < campaign.starts_at) return 'scheduled'
  if (campaign.ends_at > 0 && now >= campaign.ends_at) return 'ended'
  if (
    campaign.max_claims > 0 &&
    campaign.claimed_count >= campaign.max_claims
  ) {
    return 'sold_out'
  }
  return 'active'
}

export function unixToDate(value: number | undefined): Date | undefined {
  if (!value || value <= 0) return undefined
  return new Date(value * 1000)
}

export function dateToUnix(value: Date | undefined): number {
  if (!value) return 0
  return Math.floor(value.getTime() / 1000)
}

export function displayAmountFromQuota(quota: number): number {
  return quotaUnitsToDollars(quota)
}

export function quotaFromDisplayAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount === 0) return 0
  const sign = amount < 0 ? -1 : 1
  return sign * parseQuotaFromDollars(Math.abs(amount))
}

export function rewardClaimLink(slug: string): string {
  if (typeof window === 'undefined') return `/r/${slug}`
  return `${window.location.origin}/r/${slug}`
}
