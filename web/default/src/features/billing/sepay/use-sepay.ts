import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { BILLING_QUERY_KEYS } from '../constants'
import { cancelSePayInvoice, createSePayInvoice, getSePayInvoice } from './api'

export function useCreateSePay() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: createSePayInvoice,
    onSuccess: () => client.invalidateQueries({ queryKey: ['billing'] }),
  })
}

export function useSePay(tradeNo: string | null, open: boolean) {
  const client = useQueryClient()
  const invoice = useQuery({
    queryKey: ['sepay', 'invoice', tradeNo],
    queryFn: ({ signal }) => getSePayInvoice(tradeNo ?? '', signal),
    enabled: open && !!tradeNo,
    retry: false,
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== 'pending' ? false : 5000,
    refetchOnWindowFocus: false,
  })
  const cancel = useMutation({
    mutationFn: () => cancelSePayInvoice(tradeNo ?? ''),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['sepay', 'invoice', tradeNo] }),
        client.invalidateQueries({ queryKey: ['billing'] }),
      ])
    },
  })
  const status = invoice.data?.status
  useEffect(() => {
    if (!open || status !== 'success') return
    for (const queryKey of [
      BILLING_QUERY_KEYS.wallet,
      BILLING_QUERY_KEYS.history,
      BILLING_QUERY_KEYS.subscriptionSelf,
    ]) {
      void client.invalidateQueries({ queryKey })
    }
  }, [open, status, tradeNo, client])
  return { invoice, cancel }
}
