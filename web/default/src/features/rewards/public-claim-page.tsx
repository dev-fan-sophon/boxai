import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import { Gift, SearchX } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { getSelf } from '@/lib/api'
import { formatQuota } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { claimSelfReward, getPublicRewardCampaign } from './api'

export function PublicRewardClaimPage(props: { slug: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.auth.user)

  const { data, isLoading } = useQuery({
    queryKey: ['public-reward', props.slug],
    queryFn: async () => {
      const result = await getPublicRewardCampaign(props.slug)
      if (!result.success || !result.data) {
        throw new Error(result.message || t('Reward campaign not found'))
      }
      return result.data
    },
  })

  const claimMutation = useMutation({
    mutationFn: async () => claimSelfReward(props.slug),
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(result.message || t('Failed to claim reward'))
        return
      }
      toast.success(result.message || t('Reward claimed'))
      await getSelf()
      void navigate({ to: '/rewards' })
    },
  })

  const campaign = data
  const canClaim = campaign?.status === 'active' && campaign.enabled

  const renderCampaignBody = () => {
    if (isLoading) {
      return (
        <div className='flex flex-col items-center gap-3' aria-busy='true'>
          <Skeleton className='h-10 w-40' />
          <Skeleton className='h-4 w-24' />
          <Skeleton className='mt-3 h-10 w-full rounded-lg' />
        </div>
      )
    }
    if (!campaign) {
      return (
        <EmptyState
          icon={SearchX}
          title={t('Reward campaign not found')}
          description={t(
            'The link may be mistyped, or the campaign has ended.'
          )}
          action={
            <Button variant='outline' render={<Link to='/rewards' />}>
              {t('Rewards')}
            </Button>
          }
          bordered={false}
          className='min-h-0 py-2'
        />
      )
    }
    return (
      <div className='flex flex-col items-center gap-5 text-center'>
        <div className='flex flex-col items-center gap-2'>
          <p className='text-4xl font-semibold tracking-tight tabular-nums'>
            {formatQuota(campaign.quota)}
          </p>
          <Badge variant={canClaim ? 'success' : 'secondary'}>
            {t(publicStatusLabel(campaign.status))}
          </Badge>
        </div>
        {!user ? (
          <div className='flex w-full flex-col gap-2 sm:flex-row'>
            <Button
              size='lg'
              className='flex-1'
              render={
                <Link to='/sign-in' search={{ redirect: `/r/${props.slug}` }} />
              }
            >
              {t('Sign in to claim')}
            </Button>
            <Button
              size='lg'
              variant='outline'
              className='flex-1'
              render={
                <Link to='/sign-up' search={{ redirect: `/r/${props.slug}` }} />
              }
            >
              {t('Create account')}
            </Button>
          </div>
        ) : (
          <Button
            size='lg'
            className='w-full'
            disabled={!canClaim || claimMutation.isPending}
            onClick={() => claimMutation.mutate()}
          >
            {t('Claim reward')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className='relative isolate flex w-full justify-center px-4 py-16 sm:py-24'>
      <div
        aria-hidden='true'
        className='bg-brand-glow pointer-events-none absolute top-8 left-1/2 -z-10 size-72 -translate-x-1/2 rounded-full opacity-60 blur-3xl'
      />
      <section className='bg-card ring-border shadow-lifted flex w-full max-w-md flex-col gap-6 rounded-2xl p-6 ring-1 sm:p-8'>
        <div className='flex flex-col items-center gap-3 text-center'>
          <IconBadge tone='warning' size='lg'>
            <Gift weight='duotone' />
          </IconBadge>
          <div className='flex min-w-0 flex-col gap-1'>
            <h1 className='text-xl font-semibold tracking-tight'>
              {campaign?.name || t('Reward')}
            </h1>
            <p className='text-muted-foreground text-sm'>
              {campaign?.description ||
                t('Claim this reward into your pending Rewards balance.')}
            </p>
          </div>
        </div>
        {renderCampaignBody()}
      </section>
    </div>
  )
}

function publicStatusLabel(status: string) {
  switch (status) {
    case 'active':
      return 'Active'
    case 'scheduled':
      return 'Scheduled'
    case 'ended':
      return 'Ended'
    case 'sold_out':
      return 'Sold out'
    default:
      return 'Disabled'
  }
}
