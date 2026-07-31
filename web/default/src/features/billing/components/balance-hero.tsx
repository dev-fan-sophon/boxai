import { CreditCard, Gift, Crown, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber, formatQuota } from '@/lib/format'

import type { ActiveSubscriptionSummary } from '../lib/subscription-summary'
import type { UserWalletData } from '../types'

interface BalanceHeroProps {
  user: UserWalletData | null
  loading: boolean
  subscription: ActiveSubscriptionSummary | null
  subscriptionLoading: boolean
  redemptionEnabled: boolean
  onAddCredits: () => void
  onRedeem: () => void
  onManageSubscription: () => void
}

function SubscriptionPanel(props: BalanceHeroProps) {
  const { t } = useTranslation()

  if (props.subscriptionLoading) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-5 w-32' />
        <Skeleton className='h-2 w-full' />
        <Skeleton className='h-4 w-40' />
      </div>
    )
  }

  if (!props.subscription) {
    return (
      <div className='flex h-full flex-col justify-between gap-4'>
        <div className='flex items-center gap-2.5'>
          <IconBadge tone='warning' size='stat'>
            <Crown />
          </IconBadge>
          <div className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
            {t('Subscription')}
          </div>
        </div>
        <div>
          <p className='text-sm font-medium'>{t('No Active')}</p>
          <p className='text-muted-foreground mt-1 text-xs'>
            {t('Subscribe to a plan for model access')}
          </p>
        </div>
        <Button
          variant='outline'
          size='sm'
          className='w-fit gap-1.5'
          onClick={props.onManageSubscription}
        >
          {t('View plans')}
          <ArrowRight className='size-3.5' />
        </Button>
      </div>
    )
  }

  const summary = props.subscription
  let remainingLabel = formatQuota(summary.remaining)
  if (summary.unlimited) remainingLabel = t('Unlimited')

  return (
    <div className='flex h-full flex-col gap-3'>
      <div className='flex items-center justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <IconBadge tone='warning' size='stat'>
            <Crown />
          </IconBadge>
          <span className='truncate text-sm font-semibold'>
            {summary.planTitle || t('Subscription')}
          </span>
        </div>
        <StatusBadge label={t('Active')} variant='success' copyable={false} />
      </div>

      <div>
        <div className='flex items-baseline justify-between gap-2'>
          <span className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
            {t('Subscription remaining')}
          </span>
          <span className='font-mono text-lg font-bold tabular-nums'>
            {remainingLabel}
          </span>
        </div>
        {!summary.unlimited && summary.total > 0 && (
          <>
            <Progress value={summary.usedPercent} className='mt-2 h-1.5' />
            <div className='text-muted-foreground mt-1.5 text-xs tabular-nums'>
              {formatQuota(summary.used)} / {formatQuota(summary.total)} ·{' '}
              {t('Used')} {summary.usedPercent}%
            </div>
          </>
        )}
      </div>

      <div className='text-muted-foreground mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
        <span>
          {t('{{count}} days remaining', { count: summary.remainingDays })}
        </span>
        {summary.nextResetTime > 0 && (
          <span>
            {t('Next reset')}:{' '}
            {new Date(summary.nextResetTime * 1000).toLocaleDateString()}
          </span>
        )}
        <button
          type='button'
          onClick={props.onManageSubscription}
          className='text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline'
        >
          {t('Manage')}
          <ArrowRight className='size-3' />
        </button>
      </div>
    </div>
  )
}

/**
 * Billing headline: wallet balance on the left, active subscription state on
 * the right, with top-up and redemption entry points.
 */
export function BalanceHero(props: BalanceHeroProps) {
  const { t } = useTranslation()

  return (
    <Card data-card-hover='false' className='overflow-hidden py-0'>
      <CardContent className='grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-8'>
        <div className='flex flex-col gap-4'>
          <div className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
            {t('Account balance')}
          </div>
          {props.loading ? (
            <Skeleton className='h-10 w-48' />
          ) : (
            <div className='font-mono text-3xl font-bold tracking-tight break-all tabular-nums sm:text-4xl'>
              {formatQuota(props.user?.quota ?? 0)}
            </div>
          )}

          <div className='text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-xs'>
            <span>
              {t('Total used')}: {formatQuota(props.user?.used_quota ?? 0)}
            </span>
            <span>
              {t('Requests')}: {formatNumber(props.user?.request_count ?? 0)}
            </span>
          </div>

          <div className='flex flex-wrap gap-2'>
            <Button className='gap-2' onClick={props.onAddCredits}>
              <CreditCard className='size-4' />
              {t('Add credits')}
            </Button>
            {props.redemptionEnabled && (
              <Button variant='outline' className='gap-2' onClick={props.onRedeem}>
                <Gift className='size-4' />
                {t('Redeem code')}
              </Button>
            )}
          </div>
        </div>

        <div className='bg-muted/30 rounded-xl border p-4'>
          <SubscriptionPanel {...props} />
        </div>
      </CardContent>
    </Card>
  )
}
