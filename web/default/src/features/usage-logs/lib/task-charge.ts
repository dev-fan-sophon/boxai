import { formatLogQuota } from '@/lib/format'

import type { LogOtherData } from '../types'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** Billing fields the task APIs return for one async task. */
export type TaskBillingFields = {
  quota?: number
  /** Submission charge; 0 or absent on tasks created before it was stored. */
  pre_consumed_quota?: number
  billing_settled?: boolean
}

export type TaskCharge =
  | { kind: 'none' }
  | { kind: 'pending'; preCharged: number }
  | { kind: 'settled'; charged: number; preCharged?: number; refunded: number }

/**
 * Reads a task's charge: a pre-charge while it runs, then the final charge
 * and the part of the pre-charge returned. Quota is the pre-charge until the
 * backend marks the task settled.
 */
export function describeTaskCharge(task: TaskBillingFields): TaskCharge {
  const quota = Math.max(task.quota ?? 0, 0)
  const preCharged =
    task.pre_consumed_quota && task.pre_consumed_quota > 0
      ? task.pre_consumed_quota
      : undefined
  if (!task.billing_settled) {
    const held = preCharged ?? quota
    return held > 0 ? { kind: 'pending', preCharged: held } : { kind: 'none' }
  }
  if (quota === 0 && preCharged === undefined) return { kind: 'none' }
  return {
    kind: 'settled',
    charged: quota,
    preCharged,
    refunded: preCharged === undefined ? 0 : Math.max(preCharged - quota, 0),
  }
}

/**
 * Headline of a settlement or refund log row: what happened to the task's
 * pre-charge, followed by the pre-charge → actual figures.
 */
export function describeTaskSettlement(
  settlement: NonNullable<LogOtherData['settlement']>,
  t: Translate
): { title: string; detail: string } {
  const pre = formatLogQuota(settlement.pre_consumed_quota)
  if (settlement.reason === 'task_failed') {
    return {
      title: t('Task failed · pre-charge refunded'),
      detail: t('Refunded {{amount}}', { amount: pre }),
    }
  }
  const detail = t('Pre-charged {{pre}} · actual {{actual}}', {
    pre,
    actual: formatLogQuota(settlement.actual_quota),
  })
  if (settlement.delta > 0) {
    return {
      title: t('Task settled · extra {{amount}} charged', {
        amount: formatLogQuota(settlement.delta),
      }),
      detail,
    }
  }
  return {
    title: t('Task settled · {{amount}} refunded', {
      amount: formatLogQuota(-settlement.delta),
    }),
    detail,
  }
}

/** One-line localized summary, e.g. "Charged $0.74 · refunded $1.48". */
export function formatTaskCharge(charge: TaskCharge, t: Translate): string {
  switch (charge.kind) {
    case 'none':
      return ''
    case 'pending':
      return t('Pre-charged {{amount}}', {
        amount: formatLogQuota(charge.preCharged),
      })
    case 'settled':
      if (charge.charged === 0 && charge.refunded > 0) {
        return t('Refunded {{amount}}', {
          amount: formatLogQuota(charge.refunded),
        })
      }
      if (charge.refunded > 0) {
        return t('Charged {{charged}} · refunded {{refunded}}', {
          charged: formatLogQuota(charge.charged),
          refunded: formatLogQuota(charge.refunded),
        })
      }
      return t('Charged {{amount}}', { amount: formatLogQuota(charge.charged) })
  }
}
