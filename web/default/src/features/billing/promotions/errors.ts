import type { AxiosRequestConfig } from 'axios'
import i18next from 'i18next'

export const topUpRequestOptions: AxiosRequestConfig = {
  skipBusinessError: true,
  skipErrorHandler: true,
  validateStatus: (status) => (status >= 200 && status < 300) || status === 400,
}

export function topUpErrorMessage(response: {
  code?: string
  message?: string
}) {
  switch (response.code) {
    case 'topup_discount_invalid':
      return i18next.t('Check the promotion or coupon settings.')
    case 'topup_coupon_unavailable':
      return i18next.t(
        'This coupon is invalid, unavailable, not eligible, or has reached its usage limit.'
      )
    case 'topup_discount_non_positive':
      return i18next.t(
        'The amount due must be positive. Change the amount or coupon.'
      )
    case 'topup_order_expired':
      return i18next.t('Payment expired. Do not transfer funds.')
    case 'topup_submission_active':
      return i18next.t(
        'Payment proof is awaiting review. This order cannot be cancelled.'
      )
    case 'topup_order_unavailable':
      return i18next.t(
        'This order is unavailable, or you have too many unpaid orders.'
      )
    case 'topup_discount_failed':
      return i18next.t(
        'Unable to apply this change. Please retry or contact support.'
      )
    default:
      return response.message || i18next.t('Payment request failed')
  }
}
