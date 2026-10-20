import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { getBankQRPaymentStatus } from '../api'
import { BILLING_QUERY_KEYS } from '../constants'

/** One observer per visible checkout; details and actions share its result. */
export function useBankQRStatus(
  tradeNo: string | null | undefined,
  active: boolean,
  automaticConfirmation?: boolean
) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['bank-qr-status', tradeNo],
    queryFn: ({ signal }) => getBankQRPaymentStatus(tradeNo ?? '', signal),
    enabled: active && !!tradeNo,
    retry: false,
    refetchInterval: (state) => {
      if (state.state.data && state.state.data.status !== 'pending') {
        return false
      }
      return 5000
    },
    refetchOnWindowFocus: false,
  })
  const status = query.data?.status ?? 'pending'
  const automatic =
    automaticConfirmation === true ||
    query.data?.automatic_confirmation === true
  const terminal = status !== 'pending'

  useEffect(() => {
    if (!active || !terminal) return
    void queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEYS.wallet })
    void queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEYS.history })
    void queryClient.invalidateQueries({
      queryKey: BILLING_QUERY_KEYS.subscriptionSelf,
    })
  }, [active, terminal, tradeNo, queryClient])

  return {
    status,
    automatic,
    terminal,
    checking: query.isPending,
    error: query.isError,
  }
}

export type BankQRStatus = ReturnType<typeof useBankQRStatus>
