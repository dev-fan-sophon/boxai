import NumberFlow from '@number-flow/react'

import { getCurrentIntlLocale } from '@/i18n/languages'
import { getCurrencyDisplay } from '@/lib/currency'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

interface AnimatedQuotaProps {
  /** Raw quota units, as stored by the backend. */
  quota: number
  className?: string
}

/**
 * Quota/balance figure that animates between values with NumberFlow when the
 * display currency is a real ISO currency; token and custom-symbol displays
 * fall back to the static `formatQuota` text so the output never diverges
 * from the rest of the app.
 */
export function AnimatedQuota(props: AnimatedQuotaProps) {
  const text = formatQuota(props.quota)
  const { config, meta } = getCurrencyDisplay()
  const className = cn('font-sans tabular-nums', props.className)

  if (meta.kind !== 'currency' || !Number.isFinite(props.quota)) {
    return (
      <span className={className} title={text}>
        {text}
      </span>
    )
  }

  const value = (props.quota / config.quotaPerUnit) * meta.exchangeRate
  const locale = getCurrentIntlLocale()
  // Mirrors formatQuota: whole dong for VND, 2 digits >= 1, 4 digits below.
  let maximumFractionDigits = Math.abs(value) >= 1 ? 2 : 4
  if (meta.currencyCode === 'VND' && Math.abs(value) >= 1) {
    maximumFractionDigits = 0
  }

  return (
    <NumberFlow
      className={className}
      title={text}
      value={value}
      locales={locale}
      format={{
        style: 'currency',
        currency: meta.currencyCode,
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: 0,
        maximumFractionDigits,
      }}
    />
  )
}
