import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TitledCard } from '@/components/ui/titled-card'
import { getSelf } from '@/lib/api'
import { getCurrencyLabel } from '@/lib/currency'
import {
  formatQuota,
  parseQuotaFromDollars,
  quotaUnitsToDollars,
} from '@/lib/format'

import { claimSelfReward, getSelfRewards, redeemSelfReward } from './api'

export function RewardsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const currencyLabel = getCurrencyLabel()
  const [slug, setSlug] = useState('')
  const [redeemAmount, setRedeemAmount] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['self-rewards'],
    queryFn: async () => {
      const result = await getSelfRewards({ p: 1, page_size: 20 })
      if (!result.success || !result.data) {
        throw new Error(result.message || t('Failed to load rewards'))
      }
      return result.data
    },
  })

  const summary = data?.summary
  const ledger = data?.ledger.items ?? []

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
                <div>
                  <p className='text-2xl font-semibold'>
                    {isLoading ? '—' : formatQuota(summary?.reward_quota ?? 0)}
                  </p>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    {t('Lifetime claimed')}:{' '}
                    {formatQuota(summary?.reward_history ?? 0)}
                  </p>
                </div>
                <div className='space-y-2'>
                  <label className='text-muted-foreground text-xs font-medium'>
                    {t('Redeem amount ({{currency}})', {
                      currency: currencyLabel,
                    })}
                  </label>
                  <div className='flex gap-2'>
                    <Input
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
              icon={<Gift />}
            >
              <div className='space-y-2'>
                <Input
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  placeholder={t('welcome-2026')}
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
            <div className='overflow-hidden rounded-lg border'>
              <table className='w-full text-sm'>
                <thead className='text-muted-foreground text-left text-xs'>
                  <tr>
                    <th className='px-3 py-2'>{t('Type')}</th>
                    <th className='px-3 py-2'>{t('Change')}</th>
                    <th className='px-3 py-2'>{t('Balance')}</th>
                    <th className='px-3 py-2'>{t('Time')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((entry) => (
                    <tr key={entry.id} className='border-t'>
                      <td className='px-3 py-2'>{entry.type}</td>
                      <td className='px-3 py-2'>{formatQuota(entry.delta)}</td>
                      <td className='px-3 py-2'>
                        {formatQuota(entry.balance_after)}
                      </td>
                      <td className='px-3 py-2'>
                        {new Date(entry.created_time * 1000).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {ledger.length === 0 && (
                    <tr>
                      <td
                        className='text-muted-foreground px-3 py-6'
                        colSpan={4}
                      >
                        {t('No reward history yet')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TitledCard>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
