import { api } from '@/lib/api'

import type { ApiResponse } from '../types'
import { topUpRequestOptions, topUpErrorMessage } from './errors'

export interface PromotionTier {
  min_amount: number
  percent_off: number
  /** Zero means the tier has no discount cap. */
  max_discount: number
}

export interface Promotion {
  id: number
  enabled: boolean
  starts_at: number
  ends_at: number
  /** Ascending ladder; the server mirrors the first tier into the legacy fields. */
  tiers: PromotionTier[]
  per_user_limit: number
  total_budget: number
  banner_enabled: boolean
  banner_text: string
  banner_position: 'console_top' | 'billing' | 'both'
  /** Only on the self endpoint; -1 means the activity has no per-user limit. */
  remaining_uses?: number
  budget_exhausted?: boolean
}
export interface Coupon {
  id: number
  code: string
  enabled: boolean
  starts_at: number
  ends_at: number
  min_amount: number
  discount_type: 'fixed' | 'percent'
  discount_value: number
  max_discount: number
  total_limit: number
  per_user_limit: number
  user_id: number
  stackable: boolean
}

export async function getPromotion(admin = false): Promise<Promotion> {
  const response = await api.get<ApiResponse<Promotion>>(
    admin ? '/api/topup/promotion' : '/api/user/topup/promotion'
  )
  if (!response.data.success || !response.data.data) {
    throw new Error(response.data.message)
  }
  return response.data.data
}

export async function cancelTopUp(tradeNo: string) {
  const response = await api.post<ApiResponse>(
    `/api/user/topup/${encodeURIComponent(tradeNo)}/cancel`,
    {},
    topUpRequestOptions
  )
  if (!response.data.success) throw new Error(topUpErrorMessage(response.data))
}
