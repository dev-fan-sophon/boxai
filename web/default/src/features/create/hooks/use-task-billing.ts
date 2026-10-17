import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { getUserTaskBilling } from '@/features/usage-logs/api'
import {
  describeTaskCharge,
  formatTaskCharge,
  type TaskCharge,
} from '@/features/usage-logs/lib/task-charge'

/** The billing endpoint accepts at most this many ids per request. */
const TASK_BILLING_BATCH = 100

/**
 * Pre-charge / final charge of the studio's video tasks, keyed by task id.
 * Polls while any task is unsettled. A task that settles while the feed is
 * open announces its final charge once, so the refund of an over-estimated
 * pre-charge is visible without opening the usage logs.
 */
export function useTaskCharges(
  taskIds: string[]
): ReadonlyMap<string, TaskCharge> {
  const { t } = useTranslation()
  const ids = [...new Set(taskIds)].slice(-TASK_BILLING_BATCH).sort()
  const query = useQuery({
    queryKey: ['playground', 'task-billing', ids],
    queryFn: () => getUserTaskBilling(ids),
    enabled: ids.length > 0,
    staleTime: 5000,
    refetchInterval: (state) =>
      state.state.data?.some((view) => !view.billing_settled) ? 5000 : false,
  })

  const charges = new Map<string, TaskCharge>()
  for (const view of query.data ?? []) {
    charges.set(view.task_id, describeTaskCharge(view))
  }

  // Announce only tasks seen unsettled in this session, never history.
  const pending = useRef(new Set<string>())
  const views = query.data
  useEffect(() => {
    for (const view of views ?? []) {
      if (!view.billing_settled) {
        pending.current.add(view.task_id)
        continue
      }
      if (!pending.current.delete(view.task_id)) continue
      const charge = describeTaskCharge(view)
      if (charge.kind === 'settled' && charge.refunded > 0) {
        toast.success(t('Video task settled'), {
          description: formatTaskCharge(charge, t),
        })
      }
    }
  }, [views, t])

  return charges
}
