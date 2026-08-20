import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  adjustRewardQuota,
  getRewardClaims,
  getRewardLedgers,
} from '@/features/rewards/api'
import { quotaFromDisplayAmount } from '@/features/rewards/lib'
import { getCurrencyLabel } from '@/lib/currency'
import { formatQuota, formatTimestamp } from '@/lib/format'

export function RewardActivityPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const currencyLabel = getCurrencyLabel()
  const [userId, setUserId] = useState('')
  const [adjustAmount, setAdjustAmount] = useState('')
  const [adjustNote, setAdjustNote] = useState('')
  const parsedUserId = Number(userId)

  const adjustMutation = useMutation({
    mutationFn: async () => {
      const quota = quotaFromDisplayAmount(Number(adjustAmount) || 0)
      if (!(parsedUserId > 0) || quota === 0) {
        throw new Error(t('Enter a user ID and a non-zero amount'))
      }
      return adjustRewardQuota({
        user_id: parsedUserId,
        delta: quota,
        note: adjustNote,
      })
    },
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(result.message || t('Failed to adjust reward balance'))
        return
      }
      toast.success(t('Reward balance updated'))
      setAdjustAmount('')
      setAdjustNote('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reward-claims'] }),
        queryClient.invalidateQueries({ queryKey: ['reward-ledgers'] }),
      ])
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : t('Failed to adjust reward balance')
      )
    },
  })

  const claimsQuery = useQuery({
    queryKey: ['reward-claims', parsedUserId || 0],
    queryFn: async () => {
      const result = await getRewardClaims({
        p: 1,
        page_size: 20,
        user_id: parsedUserId > 0 ? parsedUserId : undefined,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load reward claims'))
        return []
      }
      return result.data?.items ?? []
    },
  })

  const ledgerQuery = useQuery({
    queryKey: ['reward-ledgers', parsedUserId || 0],
    queryFn: async () => {
      const result = await getRewardLedgers({
        p: 1,
        page_size: 20,
        user_id: parsedUserId > 0 ? parsedUserId : undefined,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load reward ledger'))
        return []
      }
      return result.data?.items ?? []
    },
  })

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-end gap-3'>
        <div className='space-y-1'>
          <label className='text-muted-foreground text-xs font-medium'>
            {t('Filter by user ID')}
          </label>
          <Input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder={t('All users')}
            className='w-40'
          />
        </div>
        <div className='space-y-1'>
          <label className='text-muted-foreground text-xs font-medium'>
            {t('Adjust amount ({{currency}})', { currency: currencyLabel })}
          </label>
          <Input
            type='number'
            value={adjustAmount}
            onChange={(event) => setAdjustAmount(event.target.value)}
            placeholder='10000'
            className='w-40'
          />
        </div>
        <div className='space-y-1'>
          <label className='text-muted-foreground text-xs font-medium'>
            {t('Note')}
          </label>
          <Input
            value={adjustNote}
            onChange={(event) => setAdjustNote(event.target.value)}
            className='w-48'
          />
        </div>
        <Button
          size='sm'
          onClick={() => adjustMutation.mutate()}
          disabled={adjustMutation.isPending}
        >
          {t('Adjust balance')}
        </Button>
      </div>

      <div className='grid gap-4 lg:grid-cols-2'>
        <section className='overflow-hidden rounded-lg border'>
          <header className='border-b px-3 py-2 text-sm font-medium'>
            {t('Recent claims')}
          </header>
          <div className='max-h-80 overflow-auto'>
            <table className='w-full text-sm'>
              <thead className='text-muted-foreground text-left text-xs'>
                <tr>
                  <th className='px-3 py-2'>{t('User')}</th>
                  <th className='px-3 py-2'>{t('Campaign')}</th>
                  <th className='px-3 py-2'>{t('Amount')}</th>
                  <th className='px-3 py-2'>{t('Time')}</th>
                </tr>
              </thead>
              <tbody>
                {(claimsQuery.data ?? []).map((claim) => (
                  <tr key={claim.id} className='border-t'>
                    <td className='px-3 py-2'>{claim.user_id}</td>
                    <td className='px-3 py-2'>{claim.campaign_id}</td>
                    <td className='px-3 py-2'>{formatQuota(claim.quota)}</td>
                    <td className='px-3 py-2'>
                      {formatTimestamp(claim.claimed_time)}
                    </td>
                  </tr>
                ))}
                {(claimsQuery.data ?? []).length === 0 && (
                  <tr>
                    <td className='text-muted-foreground px-3 py-6' colSpan={4}>
                      {t('No claims yet')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className='overflow-hidden rounded-lg border'>
          <header className='border-b px-3 py-2 text-sm font-medium'>
            {t('Reward ledger')}
          </header>
          <div className='max-h-80 overflow-auto'>
            <table className='w-full text-sm'>
              <thead className='text-muted-foreground text-left text-xs'>
                <tr>
                  <th className='px-3 py-2'>{t('User')}</th>
                  <th className='px-3 py-2'>{t('Type')}</th>
                  <th className='px-3 py-2'>{t('Change')}</th>
                  <th className='px-3 py-2'>{t('Time')}</th>
                </tr>
              </thead>
              <tbody>
                {(ledgerQuery.data ?? []).map((entry) => (
                  <tr key={entry.id} className='border-t'>
                    <td className='px-3 py-2'>{entry.user_id}</td>
                    <td className='px-3 py-2'>{entry.type}</td>
                    <td className='px-3 py-2'>{formatQuota(entry.delta)}</td>
                    <td className='px-3 py-2'>
                      {formatTimestamp(entry.created_time)}
                    </td>
                  </tr>
                ))}
                {(ledgerQuery.data ?? []).length === 0 && (
                  <tr>
                    <td className='text-muted-foreground px-3 py-6' colSpan={4}>
                      {t('No ledger entries yet')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
