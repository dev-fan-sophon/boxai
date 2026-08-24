import { Share2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useAffiliate, useTopupInfo } from '@/features/billing/hooks'
import { formatQuota } from '@/lib/format'

import type { UserProfile } from '../types'
import { TransferDialog } from './dialogs/transfer-dialog'

interface ReferralRewardsCardProps {
  profile: UserProfile | null
  loading?: boolean
  onTransferred?: () => void | Promise<void>
}

export function ReferralRewardsCard(props: ReferralRewardsCardProps) {
  const { t } = useTranslation()
  const {
    affiliateLink,
    loading: affiliateLoading,
    transferQuota,
    transferring,
  } = useAffiliate()
  const { topupInfo } = useTopupInfo()
  const [transferOpen, setTransferOpen] = useState(false)

  const complianceConfirmed = topupInfo?.payment_compliance_confirmed !== false
  const pendingRewards = props.profile?.aff_quota ?? 0

  const handleTransfer = async (amount: number) => {
    const success = await transferQuota(amount)
    if (success) await props.onTransferred?.()
    return success
  }

  if (props.loading || affiliateLoading) {
    return (
      <Card data-card-hover='false' className='bg-muted/20 py-0'>
        <CardContent className='grid gap-4 p-3 sm:p-4'>
          <Skeleton className='h-5 w-32' />
          <Skeleton className='h-14 rounded-lg' />
          <Skeleton className='h-10 rounded-lg' />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card data-card-hover='false' className='bg-muted/20 py-0'>
        <CardContent className='grid gap-3 p-3 sm:gap-4 sm:p-4 lg:grid-cols-[minmax(200px,1fr)_minmax(180px,0.65fr)_minmax(280px,1fr)] lg:items-center'>
          <div className='flex min-w-0 items-center gap-2.5'>
            <IconBadge tone='chart-3'>
              <Share2 />
            </IconBadge>
            <div className='min-w-0'>
              <h3 className='truncate text-sm font-semibold'>
                {t('Referral Program')}
              </h3>
              <p className='text-muted-foreground line-clamp-1 text-xs'>
                {t(
                  'Earn rewards when users join through your referral link. Transfer accumulated rewards to your balance anytime.'
                )}
              </p>
            </div>
          </div>

          <div className='grid grid-cols-3 gap-1.5 text-center'>
            {[
              [t('Pending'), formatQuota(pendingRewards)],
              [
                t('Total Earned'),
                formatQuota(props.profile?.aff_history_quota ?? 0),
              ],
              [t('Invites'), String(props.profile?.aff_count ?? 0)],
            ].map(([label, value]) => (
              <div key={label}>
                <div className='text-muted-foreground truncate text-[10px] font-medium tracking-wider uppercase'>
                  {label}
                </div>
                <div className='mt-0.5 truncate text-sm font-semibold tabular-nums'>
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div className='flex items-center gap-2'>
            <Input
              value={affiliateLink}
              readOnly
              className='border-muted bg-background/70 h-9 min-w-0 flex-1 font-mono text-xs'
            />
            <CopyButton
              value={affiliateLink}
              variant='outline'
              className='bg-background size-9 shrink-0'
              iconClassName='size-4'
              tooltip={t('Copy referral link')}
              aria-label={t('Copy referral link')}
            />
            {pendingRewards > 0 && (
              <Button
                onClick={() => setTransferOpen(true)}
                disabled={!complianceConfirmed}
                className='h-9 shrink-0 px-3'
                size='sm'
              >
                {t('Transfer to Balance')}
              </Button>
            )}
          </div>
          {!complianceConfirmed ? (
            <p className='text-muted-foreground text-xs lg:col-span-3'>
              {t(
                'Referral reward transfer is disabled until the administrator confirms compliance terms.'
              )}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        onConfirm={handleTransfer}
        availableQuota={pendingRewards}
        transferring={transferring}
      />
    </>
  )
}
