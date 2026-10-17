import { useQuery } from '@tanstack/react-query'
import i18next from 'i18next'

import { getTopupInfo } from '../api'
import { BILLING_QUERY_KEYS } from '../constants'
import { generatePresetAmounts, getMinTopupAmount } from '../lib'
import type {
  TopupInfo,
  PresetAmount,
  CreemProduct,
  PaymentMethod,
  WaffoPayMethod,
} from '../types'

// ============================================================================
// Topup Info Hook
// ============================================================================

const EMPTY_PRESETS: PresetAmount[] = []

function parseJsonArray(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data
  }

  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  return []
}

function parsePaymentMethods(
  data: unknown,
  stripeMinTopup: number,
  bankQRMinTopup: number
): PaymentMethod[] {
  return parseJsonArray(data)
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object'
    )
    .map((item) => {
      const rawMinTopup = Number(item.min_topup)
      const normalizedMinTopup = Number.isFinite(rawMinTopup) ? rawMinTopup : 0
      const type = typeof item.type === 'string' ? item.type : ''
      let minTopup = normalizedMinTopup
      if (minTopup <= 0 && type === 'stripe') {
        minTopup = stripeMinTopup
      } else if (minTopup <= 0 && type === 'bank_qr') {
        minTopup = bankQRMinTopup
      }

      return {
        name: typeof item.name === 'string' ? item.name : '',
        type,
        color: typeof item.color === 'string' ? item.color : undefined,
        icon: typeof item.icon === 'string' ? item.icon : undefined,
        min_topup: minTopup,
      }
    })
    .filter((item) => item.name && item.type && item.type !== 'waffo')
}

function parseWaffoPayMethods(data: unknown): WaffoPayMethod[] {
  return parseJsonArray(data)
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object'
    )
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : '',
      icon: typeof item.icon === 'string' ? item.icon : undefined,
      payMethodType:
        typeof item.payMethodType === 'string' ? item.payMethodType : undefined,
      payMethodName:
        typeof item.payMethodName === 'string' ? item.payMethodName : undefined,
    }))
    .filter((item) => item.name)
}

function parseCreemProducts(data: unknown): CreemProduct[] {
  return parseJsonArray(data)
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object'
    )
    .map((item) => {
      const currency: CreemProduct['currency'] =
        item.currency === 'EUR' ? 'EUR' : 'USD'

      return {
        name: typeof item.name === 'string' ? item.name : '',
        productId: typeof item.productId === 'string' ? item.productId : '',
        price: Number(item.price) || 0,
        quota: Number(item.quota) || 0,
        currency,
      }
    })
    .filter((item) => item.name && item.productId)
}

function parseAmountOptions(data: unknown): number[] {
  return parseJsonArray(data)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
}

export interface TopupInfoQueryData {
  topupInfo: TopupInfo
  presetAmounts: PresetAmount[]
}

async function fetchTopupInfo(): Promise<TopupInfoQueryData> {
  const response = await getTopupInfo()
  if (!response.success || !response.data) {
    throw new Error(
      response.message || i18next.t('Failed to load top-up options')
    )
  }

  const topupInfo: TopupInfo = {
    ...response.data,
    pay_methods: parsePaymentMethods(
      response.data.pay_methods,
      response.data.stripe_min_topup,
      response.data.bank_qr_min_topup || 0
    ),
    amount_options: parseAmountOptions(response.data.amount_options),
    creem_products: parseCreemProducts(response.data.creem_products),
    waffo_pay_methods: parseWaffoPayMethods(response.data.waffo_pay_methods),
  }

  const presetAmounts =
    topupInfo.amount_options.length > 0
      ? topupInfo.amount_options.map((value) => ({ value }))
      : generatePresetAmounts(getMinTopupAmount(topupInfo))

  return { topupInfo, presetAmounts }
}

/**
 * Top-up configuration (payment methods, presets, discounts). Shared between
 * the billing page and the profile referral card through the query cache.
 */
export function useTopupInfo() {
  const query = useQuery({
    queryKey: BILLING_QUERY_KEYS.topupInfo,
    queryFn: fetchTopupInfo,
    // The API interceptor already toasts each failure; retry is user-driven.
    retry: false,
  })

  return {
    topupInfo: query.data?.topupInfo ?? null,
    presetAmounts: query.data?.presetAmounts ?? EMPTY_PRESETS,
    loading: query.isPending,
    isError: query.isError,
    refetch: query.refetch,
  }
}
