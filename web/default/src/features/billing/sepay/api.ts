import { api } from '@/lib/api'

import type { ApiResponse } from '../types'

export interface SePayQuote {
  amount: number
  currency: 'VND'
  credit_usd?: number
}

export interface SePayInvoice extends SePayQuote {
  trade_no: string
  transfer_content: string
  payload: string
  bank_name: string
  bank_bin: string
  account_number: string
  account_name: string
  expires_at: number
  status: 'pending' | 'success' | 'cancelled' | 'expired'
}

export async function quoteSePay(amount: number) {
  const res = await api.post<ApiResponse<SePayQuote>>(
    '/api/user/sepay/amount',
    { amount }
  )
  return res.data
}

export async function createSePayInvoice(
  input: { amount: number } | { plan_id: number }
) {
  const path =
    'plan_id' in input ? '/api/subscription/sepay/pay' : '/api/user/sepay/pay'
  const res = await api.post<ApiResponse<SePayInvoice>>(path, input)
  if (!res.data.success || !res.data.data) {
    throw new Error(res.data.message || 'Payment request failed')
  }
  return res.data.data
}

export async function getSePayInvoice(tradeNo: string, signal?: AbortSignal) {
  const res = await api.get<ApiResponse<SePayInvoice>>(
    `/api/user/sepay/${encodeURIComponent(tradeNo)}`,
    { signal }
  )
  if (!res.data.success || !res.data.data) {
    throw new Error(res.data.message || 'Payment request failed')
  }
  return res.data.data
}

export async function cancelSePayInvoice(tradeNo: string) {
  const res = await api.post<ApiResponse>(
    `/api/user/sepay/${encodeURIComponent(tradeNo)}/cancel`
  )
  if (!res.data.success) {
    throw new Error(res.data.message || 'Payment request failed')
  }
}
