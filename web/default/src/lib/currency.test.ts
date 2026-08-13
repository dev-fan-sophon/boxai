import { beforeEach, describe, expect, it } from 'vitest'

import { useSystemConfigStore } from '@/stores/system-config-store'

import {
  convertLocalAmountToUsd,
  convertUsdToLocalAmount,
  formatUSDAmount,
  isNonUsdCurrencyDisplay,
} from './currency'

describe('USD display helpers', () => {
  beforeEach(() => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        displayInCurrency: true,
        quotaDisplayType: 'VND',
        quotaPerUnit: 500000,
        usdExchangeRate: 26000,
        customCurrencySymbol: '¤',
        customCurrencyExchangeRate: 1,
      },
    })
  })

  it('formats a system USD amount without converting to VND', () => {
    expect(
      formatUSDAmount(2, {
        digitsLarge: 2,
        digitsSmall: 2,
        abbreviate: false,
        locale: 'en-US',
      })
    ).toBe('$2')
  })

  it('converts USD to VND and back at the configured rate', () => {
    expect(convertUsdToLocalAmount(2)).toBe(52000)
    expect(convertLocalAmountToUsd(52000)).toBe(2)
    expect(isNonUsdCurrencyDisplay()).toBe(true)
  })

  it('does not convert when the site display currency is already USD', () => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        displayInCurrency: true,
        quotaDisplayType: 'USD',
        quotaPerUnit: 500000,
        usdExchangeRate: 26000,
        customCurrencySymbol: '¤',
        customCurrencyExchangeRate: 1,
      },
    })

    expect(isNonUsdCurrencyDisplay()).toBe(false)
    expect(convertUsdToLocalAmount(10)).toBeNull()
    expect(convertLocalAmountToUsd(260000)).toBeNull()
  })
})
