import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { CreditCard, Gift, Crown, ArrowRight } from '@/components/icons'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { AnimatedQuota } from '@/features/dashboard/components/ui/animated-quota'
import { formatNumber, formatQuota } from '@/lib/format'

import type { ActiveSubscriptionSummary } from '../lib/subscription-summary'
import type { UserWalletData } from '../types'

interface BalanceHeroProps {
  user: UserWalletData | null
  loading: boolean
  isError: boolean
  onRetry: () => void
  subscription: ActiveSubscriptionSummary | null
  subscriptionLoading: boolean
  subscriptionError: boolean
  onRetrySubscription: () => void
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

  if (props.subscriptionError && !props.subscription) {
    return (
      <ErrorState
        title={t('Failed to load subscription')}
        onRetry={props.onRetrySubscription}
        className='min-h-40 p-2'
      />
    )
  }

  if (!props.subscription) {
    return (
      <div className='flex h-full flex-col justify-between gap-4'>
        <div className='flex items-center gap-2.5'>
          <IconBadge tone='warning' size='stat'>
            <Crown />
          </IconBadge>
          <div className='text-muted-foreground text-sm font-medium'>
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
        <div className='flex flex-wrap items-baseline justify-between gap-x-2'>
          <span className='text-muted-foreground min-w-0 text-xs font-medium'>
            {t('Subscription remaining')}
          </span>
          <span className='shrink-0 text-lg font-semibold tabular-nums'>
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

  let balanceContent
  if (props.loading) {
    balanceContent = (
      <div className='space-y-2' aria-busy='true'>
        <Skeleton className='h-10 w-48' />
        <Skeleton className='h-4 w-56' />
      </div>
    )
  } else if (props.isError && !props.user) {
    balanceContent = (
      <ErrorState
        title={t('Failed to load account balance')}
        onRetry={props.onRetry}
        className='bg-muted/20 min-h-32 border p-3'
      />
    )
  } else {
    balanceContent = (
      <>
        <AnimatedQuota
          quota={props.user?.quota ?? 0}
          className='block max-w-full truncate text-3xl leading-tight font-semibold tracking-tight sm:text-4xl'
        />
        <dl className='flex flex-wrap gap-x-6 gap-y-2'>
          <div className='flex min-w-0 flex-col gap-0.5'>
            <dt className='text-muted-foreground text-xs'>{t('Total used')}</dt>
            <dd className='text-sm font-medium tabular-nums'>
              {formatQuota(props.user?.used_quota ?? 0)}
            </dd>
          </div>
          <div className='flex min-w-0 flex-col gap-0.5'>
            <dt className='text-muted-foreground text-xs'>{t('Requests')}</dt>
            <dd className='text-sm font-medium tabular-nums'>
              {formatNumber(props.user?.request_count ?? 0)}
            </dd>
          </div>
        </dl>
      </>
    )
  }

  return (
    <Card data-card-hover='false' className='overflow-hidden py-0'>
      <CardContent className='grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-8'>
        <div className='flex flex-col gap-4'>
          <div className='text-muted-foreground text-sm font-medium'>
            {t('Account balance')}
          </div>
          {balanceContent}

          <div className='flex flex-wrap gap-2'>
            <Button onClick={props.onAddCredits}>
              <CreditCard data-icon='inline-start' />
              {t('Add credits')}
            </Button>
            {props.redemptionEnabled && (
              <Button variant='outline' onClick={props.onRedeem}>
                <Gift data-icon='inline-start' />
                {t('Redeem code')}
              </Button>
            )}
          </div>
        </div>

        <div className='bg-surface-subtle ring-border rounded-xl p-4 ring-1 sm:p-5'>
          <SubscriptionPanel {...props} />
        </div>
      </CardContent>
    </Card>
  )
}
