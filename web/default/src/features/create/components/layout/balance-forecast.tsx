import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { AlertTriangle, Wallet } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { formatRunway, useQuotaForecast } from '@/hooks/use-quota-forecast'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Studio balance chip: current balance, and on open how long it lasts at the
 * user's recent spending pace. Turns into a warning when the forecast is low.
 */
export function BalanceForecast() {
  const { t } = useTranslation()
  const forecast = useQuotaForecast().data
  if (!forecast) return null

  const balance = formatQuota(Math.max(forecast.quota, 0))
  const runway = formatRunway(forecast.days_left, t)
  const Icon = forecast.low ? AlertTriangle : Wallet

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type='button'
            className={cn(
              'focus-visible:ring-ring inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium tabular-nums ring-1 outline-none focus-visible:ring-2',
              forecast.low
                ? 'bg-warning/10 text-warning ring-warning/30'
                : 'bg-muted/70 text-muted-foreground ring-border/60 hover:text-foreground'
            )}
            aria-label={t('Balance forecast')}
          />
        }
      >
        <Icon className='size-3.5' aria-hidden='true' />
        {balance}
      </PopoverTrigger>
      <PopoverContent align='end' sideOffset={8} className='w-72 gap-3 p-3'>
        <PopoverHeader>
          <PopoverTitle>{t('Balance forecast')}</PopoverTitle>
          <PopoverDescription>
            {t('Estimated from your spending over the last 7 days.')}
          </PopoverDescription>
        </PopoverHeader>
        <dl className='grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-xs'>
          <dt className='text-muted-foreground'>{t('Balance')}</dt>
          <dd className='font-medium tabular-nums'>{balance}</dd>
          <dt className='text-muted-foreground'>{t('Spent in last 24h')}</dt>
          <dd className='font-medium tabular-nums'>
            {formatQuota(forecast.spent_24h)}
          </dd>
          <dt className='text-muted-foreground'>{t('Typical daily spend')}</dt>
          <dd className='font-medium tabular-nums'>
            {formatQuota(forecast.daily_spend)}
          </dd>
          <dt className='text-muted-foreground'>{t('Estimated to last')}</dt>
          <dd
            className={cn(
              'font-medium tabular-nums',
              forecast.low && 'text-warning'
            )}
          >
            {runway ?? t('No recent usage')}
          </dd>
        </dl>
        {forecast.low && (
          <p className='text-warning text-xs'>
            {t('Your balance is running low')}
          </p>
        )}
        <Button
          size='sm'
          variant={forecast.low ? 'default' : 'outline'}
          render={<Link to='/billing' />}
        >
          {t('Top up')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
