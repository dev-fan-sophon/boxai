import { useCallback, useEffect, useState } from 'react'

import {
  getPublicPlans,
  getSelfSubscriptionFull,
} from '@/features/subscriptions/api'
import type {
  PendingBankQRSubscriptionOrder,
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'

export interface SubscriptionCenterData {
  plans: PlanRecord[]
  activeSubscriptions: UserSubscriptionRecord[]
  allSubscriptions: UserSubscriptionRecord[]
  pendingBankQROrders: PendingBankQRSubscriptionOrder[]
  overageEnabled: boolean
  overageLimitUsd: number
}

const EMPTY_DATA: SubscriptionCenterData = {
  plans: [],
  activeSubscriptions: [],
  allSubscriptions: [],
  pendingBankQROrders: [],
  overageEnabled: false,
  overageLimitUsd: 0,
}

/**
 * Shared subscription state for the billing page: the hero summary and the
 * plans section render the same data, so both APIs are fetched once here.
 */
export function useSubscriptionCenter() {
  const [data, setData] = useState<SubscriptionCenterData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchSelfSubscription = useCallback(async () => {
    try {
      const res = await getSelfSubscriptionFull()
      if (!res.success || !res.data) return
      setData((prev) => ({
        ...prev,
        activeSubscriptions: res.data?.subscriptions || [],
        allSubscriptions: res.data?.all_subscriptions || [],
        pendingBankQROrders: res.data?.pending_bank_qr_orders || [],
        overageEnabled: !!res.data?.overage_enabled,
        overageLimitUsd: Number(res.data?.overage_limit_usd || 0),
      }))
    } catch {
      /* keep previous data */
    }
  }, [])

  const fetchPlans = useCallback(async () => {
    try {
      const res = await getPublicPlans()
      if (!res.success) return
      setData((prev) => ({ ...prev, plans: res.data || [] }))
    } catch {
      /* keep previous data */
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.all([fetchPlans(), fetchSelfSubscription()])
      setLoading(false)
    }
    void init()
  }, [fetchPlans, fetchSelfSubscription])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await fetchSelfSubscription()
    } finally {
      setRefreshing(false)
    }
  }, [fetchSelfSubscription])

  const applyOverageSettings = useCallback(
    (enabled: boolean, limitUsd: number) => {
      setData((prev) => ({
        ...prev,
        overageEnabled: enabled,
        overageLimitUsd: limitUsd,
      }))
    },
    []
  )

  return { data, loading, refreshing, refresh, applyOverageSettings }
}
