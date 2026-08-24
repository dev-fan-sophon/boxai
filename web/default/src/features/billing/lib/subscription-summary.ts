import type {
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'

export interface ActiveSubscriptionSummary {
  count: number
  planTitle: string
  unlimited: boolean
  total: number
  used: number
  remaining: number
  usedPercent: number
  endTime: number
  nextResetTime: number
  remainingDays: number
}

/**
 * Collapses every active subscription into the single headline the billing
 * hero shows. The subscription ending first is treated as the primary one,
 * mirroring the backend rule that attributes overage to that period.
 */
export function summarizeActiveSubscriptions(
  records: UserSubscriptionRecord[],
  plans: PlanRecord[]
): ActiveSubscriptionSummary | null {
  const now = Date.now() / 1000
  const active = records.filter(
    (record) =>
      record.subscription?.status === 'active' &&
      (record.subscription?.end_time || 0) > now
  )
  if (active.length === 0) return null

  const primary = [...active].sort((a, b) => {
    const endDiff =
      (a.subscription?.end_time || 0) - (b.subscription?.end_time || 0)
    if (endDiff !== 0) return endDiff
    return (a.subscription?.id || 0) - (b.subscription?.id || 0)
  })[0]

  const planTitle =
    plans.find((p) => p.plan?.id === primary.subscription?.plan_id)?.plan
      ?.title || ''
  const unlimited = active.some(
    (record) => (record.subscription?.amount_total || 0) <= 0
  )

  let total = 0
  let used = 0
  for (const record of active) {
    total += record.subscription?.amount_total || 0
    used += record.subscription?.amount_used || 0
  }
  const remaining = Math.max(0, total - used)
  const endTime = primary.subscription?.end_time || 0

  return {
    count: active.length,
    planTitle,
    unlimited,
    total,
    used,
    remaining,
    usedPercent:
      total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0,
    endTime,
    nextResetTime: primary.subscription?.next_reset_time || 0,
    remainingDays: Math.max(0, Math.ceil((endTime - now) / 86400)),
  }
}
