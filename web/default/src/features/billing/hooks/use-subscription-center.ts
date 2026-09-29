import { useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { useCallback, useMemo } from 'react'

import {
  getPublicPlans,
  getSelfSubscriptionFull,
} from '@/features/subscriptions/api'
import type {
  PendingBankQRSubscriptionOrder,
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'

import { BILLING_QUERY_KEYS } from '../constants'

export interface SubscriptionCenterData {
  plans: PlanRecord[]
  activeSubscriptions: UserSubscriptionRecord[]
  allSubscriptions: UserSubscriptionRecord[]
  pendingBankQROrders: PendingBankQRSubscriptionOrder[]
  overageEnabled: boolean
  overageLimitUsd: number
}

type SelfSubscriptionState = Omit<SubscriptionCenterData, 'plans'>

const EMPTY_PLANS: PlanRecord[] = []

const EMPTY_SELF: SelfSubscriptionState = {
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
  const queryClient = useQueryClient()

  const plansQuery = useQuery({
    queryKey: BILLING_QUERY_KEYS.subscriptionPlans,
    queryFn: async () => {
      const res = await getPublicPlans()
      if (!res.success) {
        throw new Error(
          res.message || i18next.t('Failed to load subscription plans')
        )
      }
      return res.data || []
    },
    retry: false,
  })

  const selfQuery = useQuery({
    queryKey: BILLING_QUERY_KEYS.subscriptionSelf,
    queryFn: async (): Promise<SelfSubscriptionState> => {
      const res = await getSelfSubscriptionFull()
      if (!res.success || !res.data) {
        throw new Error(
          res.message || i18next.t('Failed to load subscription plans')
        )
      }
      return {
        activeSubscriptions: res.data.subscriptions || [],
        allSubscriptions: res.data.all_subscriptions || [],
        pendingBankQROrders: res.data.pending_bank_qr_orders || [],
        overageEnabled: !!res.data.overage_enabled,
        overageLimitUsd: Number(res.data.overage_limit_usd || 0),
      }
    },
    retry: false,
  })

  const plans = plansQuery.data ?? EMPTY_PLANS
  const self = selfQuery.data ?? EMPTY_SELF
  const data = useMemo<SubscriptionCenterData>(
    () => ({ plans, ...self }),
    [plans, self]
  )

  const refetchSelf = selfQuery.refetch
  const refresh = useCallback(async () => {
    await refetchSelf()
  }, [refetchSelf])

  const refetchPlans = plansQuery.refetch
  const refetch = useCallback(async () => {
    await Promise.all([refetchPlans(), refetchSelf()])
  }, [refetchPlans, refetchSelf])

  // Optimistic write used by the overage toggle before/after the API call.
  const applyOverageSettings = useCallback(
    (enabled: boolean, limitUsd: number) => {
      queryClient.setQueryData<SelfSubscriptionState>(
        BILLING_QUERY_KEYS.subscriptionSelf,
        (prev) => ({
          ...(prev ?? EMPTY_SELF),
          overageEnabled: enabled,
          overageLimitUsd: limitUsd,
        })
      )
    },
    [queryClient]
  )

  return {
    data,
    loading: plansQuery.isPending || selfQuery.isPending,
    refreshing: selfQuery.isFetching && !selfQuery.isPending,
    isError: plansQuery.isError || selfQuery.isError,
    refresh,
    refetch,
    applyOverageSettings,
  }
}
