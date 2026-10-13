import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { formatRunway, useQuotaForecast } from '@/hooks/use-quota-forecast'
import { formatQuota } from '@/lib/format'
import { useNotificationStore } from '@/stores/notification-store'

/**
 * In-app low-balance warning, at most once a day. Fires when the balance is
 * under the user's warning threshold or the spending forecast says it runs
 * out within a few days.
 */
export function LowBalanceAlert() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const forecast = useQuotaForecast().data
  const warnedOn = useNotificationStore((state) => state.lowBalanceWarnedOn)
  const setWarnedOn = useNotificationStore(
    (state) => state.setLowBalanceWarnedOn
  )

  useEffect(() => {
    if (!forecast?.low) return
    const today = new Date().toDateString()
    if (warnedOn === today) return

    setWarnedOn(today)
    const runway = formatRunway(forecast.days_left, t)
    const balance = formatQuota(Math.max(forecast.quota, 0))
    toast.warning(t('Your balance is running low'), {
      id: 'low-balance',
      duration: 15000,
      description: runway
        ? t('Balance {{balance}} lasts {{runway}} at your recent usage.', {
            balance,
            runway,
          })
        : t('Balance {{balance}}. Top up to keep requests running.', {
            balance,
          }),
      action: {
        label: t('Top up'),
        onClick: () => void navigate({ to: '/billing' }),
      },
    })
  }, [forecast, warnedOn, setWarnedOn, navigate, t])

  return null
}
