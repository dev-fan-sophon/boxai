import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Gift, Sparkles } from '@/components/icons'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import { AnimatedQuota } from '@/features/dashboard/components/ui/animated-quota'
import { getSelf } from '@/lib/api'
import { getCurrencyLabel } from '@/lib/currency'
import {
  formatQuota,
  parseQuotaFromDollars,
  quotaUnitsToDollars,
} from '@/lib/format'
import { cn } from '@/lib/utils'

import { claimSelfReward, getSelfRewards, redeemSelfReward } from './api'
import type { RewardLedgerEntry } from './types'

const LEDGER_SKELETON_KEYS = ['one', 'two', 'three', 'four', 'five']
const EMPTY_LEDGER: RewardLedgerEntry[] = []

export function RewardsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const currencyLabel = getCurrencyLabel()
  const [slug, setSlug] = useState('')
  const [redeemAmount, setRedeemAmount] = useState('')

  const rewardsQuery = useQuery({
    queryKey: ['self-rewards'],
    queryFn: async () => {
      const result = await getSelfRewards({ p: 1, page_size: 20 })
      if (!result.success || !result.data) {
        throw new Error(result.message || t('Failed to load rewards'))
      }
      return result.data
    },
    // The API interceptor already toasts each failure; retry is user-driven.
    retry: false,
  })

  const isLoading = rewardsQuery.isPending
  const loadFailed = rewardsQuery.isError && !rewardsQuery.data
  const summary = rewardsQuery.data?.summary
  const ledger = rewardsQuery.data?.ledger.items ?? EMPTY_LEDGER
  const retryRewards = () => void rewardsQuery.refetch()

  const claimMutation = useMutation({
    mutationFn: async () => claimSelfReward(slug.trim()),
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(result.message || t('Failed to claim reward'))
        return
      }
      toast.success(result.message || t('Reward claimed'))
      setSlug('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['self-rewards'] }),
        getSelf(),
      ])
    },
  })

  const redeemMutation = useMutation({
    mutationFn: async () => {
      const quota = parseQuotaFromDollars(Number(redeemAmount) || 0)
      return redeemSelfReward(quota)
    },
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(result.message || t('Failed to redeem reward'))
        return
      }
      toast.success(result.message || t('Reward transferred to your balance'))
      setRedeemAmount('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['self-rewards'] }),
        getSelf(),
      ])
    },
  })

  let pendingSummary
  if (isLoading) {
    pendingSummary = (
      <div className='space-y-2' aria-busy='true'>
        <Skeleton className='h-8 w-32' />
        <Skeleton className='h-3 w-40' />
      </div>
    )
  } else if (loadFailed) {
    pendingSummary = (
      <ErrorState
        title={t('Failed to load rewards')}
        onRetry={retryRewards}
        className='min-h-32 border p-3'
      />
    )
  } else {
    pendingSummary = (
      <div className='min-w-0'>
        <AnimatedQuota
          quota={summary?.reward_quota ?? 0}
          className='block max-w-full truncate text-3xl leading-tight font-semibold tracking-tight'
        />
        <p className='text-muted-foreground mt-1 text-xs tabular-nums'>
          {t('Lifetime claimed')}: {formatQuota(summary?.reward_history ?? 0)}
        </p>
      </div>
    )
  }

  let ledgerContent
  if (isLoading) {
    ledgerContent = (
      <div className='overflow-hidden rounded-xl border' aria-busy='true'>
        <ul className='divide-y sm:hidden'>
          {LEDGER_SKELETON_KEYS.map((key) => (
            <li key={key} className='space-y-2 px-3 py-3'>
              <div className='flex justify-between gap-3'>
                <Skeleton className='h-4 w-20' />
                <Skeleton className='h-4 w-16' />
              </div>
              <Skeleton className='h-3 w-40' />
            </li>
          ))}
        </ul>
        <table className='hidden w-full text-sm sm:table'>
          <tbody>
            {LEDGER_SKELETON_KEYS.map((key) => (
              <tr key={key} className='border-t first:border-t-0'>
                <td className='px-3 py-3'>
                  <Skeleton className='h-4 w-20' />
                </td>
                <td className='px-3 py-3'>
                  <Skeleton className='h-4 w-16' />
                </td>
                <td className='px-3 py-3'>
                  <Skeleton className='h-4 w-16' />
                </td>
                <td className='px-3 py-3'>
                  <Skeleton className='h-4 w-32' />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  } else if (loadFailed) {
    ledgerContent = (
      <ErrorState
        title={t('Failed to load reward history')}
        description={t('Check your connection and try again.')}
        onRetry={retryRewards}
        className='min-h-60'
      />
    )
  } else if (ledger.length === 0) {
    ledgerContent = (
      <EmptyState
        icon={Gift}
        title={t('No reward history yet')}
        description={t('Claimed and redeemed rewards will appear here.')}
        bordered={false}
        className='min-h-0 py-8'
      />
    )
  } else {
    ledgerContent = (
      <div className='overflow-hidden rounded-xl border'>
        <ul className='divide-y sm:hidden'>
          {ledger.map((entry) => (
            <li key={entry.id} className='space-y-1 px-3 py-3 text-sm'>
              <div className='flex items-baseline justify-between gap-3'>
                <span className='font-medium'>{entry.type}</span>
                <span
                  className={cn(
                    'font-semibold tabular-nums',
                    entry.delta > 0 && 'text-success'
                  )}
                >
                  {entry.delta > 0 ? '+' : ''}
                  {formatQuota(entry.delta)}
                </span>
              </div>
              <div className='text-muted-foreground flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs'>
                <span>
                  {t('Balance')}: {formatQuota(entry.balance_after)}
                </span>
                <span>
                  {new Date(entry.created_time * 1000).toLocaleString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <table className='hidden w-full text-sm sm:table'>
          <thead className='bg-muted/40 text-muted-foreground text-left text-xs'>
            <tr>
              <th className='px-3 py-2 font-medium whitespace-nowrap'>
                {t('Type')}
              </th>
              <th className='px-3 py-2 font-medium whitespace-nowrap'>
                {t('Change')}
              </th>
              <th className='px-3 py-2 font-medium whitespace-nowrap'>
                {t('Balance')}
              </th>
              <th className='px-3 py-2 font-medium whitespace-nowrap'>
                {t('Time')}
              </th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((entry) => (
              <tr key={entry.id} className='border-t'>
                <td className='px-3 py-2.5'>{entry.type}</td>
                <td
                  className={cn(
                    'px-3 py-2.5 font-medium tabular-nums',
                    entry.delta > 0 && 'text-success'
                  )}
                >
                  {entry.delta > 0 ? '+' : ''}
                  {formatQuota(entry.delta)}
                </td>
                <td className='px-3 py-2.5 tabular-nums'>
                  {formatQuota(entry.balance_after)}
                </td>
                <td className='px-3 py-2.5'>
                  {new Date(entry.created_time * 1000).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Rewards')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto flex w-full max-w-5xl flex-col gap-5'>
          <div className='grid gap-4 md:grid-cols-2'>
            <TitledCard
              title={t('Pending rewards')}
              description={t(
                'Claimed quota waiting to be moved into your wallet'
              )}
              icon={<Gift />}
              iconTone='warning'
            >
              <div className='space-y-4'>
                {pendingSummary}
                <div className='space-y-2'>
                  <Label htmlFor='reward-redeem-amount'>
                    {t('Redeem amount ({{currency}})', {
                      currency: currencyLabel,
                    })}
                  </Label>
                  <div className='flex gap-2'>
                    <Input
                      id='reward-redeem-amount'
                      type='number'
                      min={0}
                      value={redeemAmount}
                      onChange={(event) => setRedeemAmount(event.target.value)}
                      placeholder={
                        summary
                          ? String(
                              quotaUnitsToDollars(summary.min_redeem_quota)
                            )
                          : ''
                      }
                    />
                    <Button
                      onClick={() => redeemMutation.mutate()}
                      disabled={
                        redeemMutation.isPending ||
                        !summary?.enabled ||
                        (summary?.reward_quota ?? 0) <= 0
                      }
                    >
                      {t('Redeem')}
                    </Button>
                  </div>
                  {summary ? (
                    <p className='text-muted-foreground text-xs'>
                      {t('Minimum: {{amount}}', {
                        amount: formatQuota(summary.min_redeem_quota),
                      })}
                    </p>
                  ) : null}
                </div>
              </div>
            </TitledCard>

            <TitledCard
              title={t('Claim a reward')}
              description={t('Paste a campaign slug or open a reward link')}
              icon={<Sparkles />}
              iconTone='primary'
            >
              <div className='space-y-3'>
                <Label htmlFor='reward-claim-slug'>{t('Campaign code')}</Label>
                <Input
                  id='reward-claim-slug'
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  placeholder={t('e.g. welcome-2026')}
                />
                <Button
                  className='w-full'
                  onClick={() => claimMutation.mutate()}
                  disabled={claimMutation.isPending || !slug.trim()}
                >
                  {t('Claim reward')}
                </Button>
              </div>
            </TitledCard>
          </div>

          <TitledCard title={t('Reward history')} disableHoverEffect>
            {ledgerContent}
          </TitledCard>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
