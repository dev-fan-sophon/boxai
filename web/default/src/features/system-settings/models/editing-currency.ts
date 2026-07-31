/**
 * Editing-currency support for the model pricing editor.
 *
 * Canonical model prices are always stored in USD. When the site is configured
 * with a local display currency (VND/CNY/custom), operators may type prices in
 * that currency; values are converted to USD at the configured rate before
 * they reach form state, so everything downstream (preview, save, billing
 * expressions) keeps USD semantics.
 */
import { useMemo } from 'react'

import {
  useSystemConfigStore,
  type CurrencyConfig,
} from '@/stores/system-config-store'

export type EditingCurrencyMode = 'USD' | 'LOCAL'

export type LocalPriceCurrency = {
  /** Short label shown on the currency toggle, e.g. VND / CNY / ¤ */
  code: string
  symbol: string
  /** 1 USD = `rate` units of the local currency */
  rate: number
}

const STORAGE_KEY = 'pricing-editor-currency-mode'

function isUsableRate(rate: number): boolean {
  return Number.isFinite(rate) && rate > 0
}

function resolveLocalPriceCurrency(
  currency: CurrencyConfig
): LocalPriceCurrency | null {
  switch (currency.quotaDisplayType) {
    case 'CNY':
      return isUsableRate(currency.usdExchangeRate)
        ? { code: 'CNY', symbol: '¥', rate: currency.usdExchangeRate }
        : null
    case 'VND':
      return isUsableRate(currency.usdExchangeRate)
        ? { code: 'VND', symbol: '₫', rate: currency.usdExchangeRate }
        : null
    case 'CUSTOM': {
      const symbol = currency.customCurrencySymbol.trim()
      return symbol && isUsableRate(currency.customCurrencyExchangeRate)
        ? { code: symbol, symbol, rate: currency.customCurrencyExchangeRate }
        : null
    }
    default:
      return null
  }
}

/** Site local currency usable for price entry, or null when USD/tokens-only. */
export function useLocalPriceCurrency(): LocalPriceCurrency | null {
  const currency = useSystemConfigStore((state) => state.config.currency)
  return useMemo(() => resolveLocalPriceCurrency(currency), [currency])
}

export function readEditingCurrencyMode(): EditingCurrencyMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'LOCAL' ? 'LOCAL' : 'USD'
  } catch {
    return 'USD'
  }
}

export function storeEditingCurrencyMode(mode: EditingCurrencyMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Persisting the preference is best-effort only.
  }
}

function trimTrailingZeros(value: string): string {
  if (!value.includes('.')) return value
  return value.replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * Convert a canonical USD amount string to its local-currency equivalent.
 * Returns a plain decimal string (never exponent notation) so the result
 * stays compatible with the numeric draft validation used by price inputs.
 */
export function usdToLocalAmount(
  usdValue: string,
  currency: LocalPriceCurrency
): string {
  if (usdValue === '') return ''
  const amount = Number(usdValue)
  if (!Number.isFinite(amount)) return ''
  return trimTrailingZeros((amount * currency.rate).toFixed(6))
}

/** Convert a local-currency amount string to its canonical USD equivalent. */
export function localToUsdAmount(
  localValue: string,
  currency: LocalPriceCurrency
): string {
  if (localValue === '') return ''
  const amount = Number(localValue)
  if (!Number.isFinite(amount)) return ''
  return trimTrailingZeros((amount / currency.rate).toFixed(12))
}

export function formatLocalRate(currency: LocalPriceCurrency): string {
  return `${currency.symbol}${currency.rate.toLocaleString()}`
}
