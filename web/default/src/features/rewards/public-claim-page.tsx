import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Gift } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'
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
      return <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
    }
    if (!campaign) {
      return (
        <p className='text-muted-foreground text-sm'>
          {t('Reward campaign not found')}
        </p>
      )
    }
    return (
      <>
        <div>
          <p className='text-3xl font-semibold'>
            {formatQuota(campaign.quota)}
          </p>
          <p className='text-muted-foreground mt-1 text-xs'>
            {t('Status')}: {t(publicStatusLabel(campaign.status))}
          </p>
        </div>
        {!user ? (
          <div className='flex flex-col gap-2 sm:flex-row'>
            <Button
              className='flex-1'
              render={
                <Link to='/sign-in' search={{ redirect: `/r/${props.slug}` }} />
              }
            >
              {t('Sign in to claim')}
            </Button>
            <Button
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
            className='w-full'
            disabled={!canClaim || claimMutation.isPending}
            onClick={() => claimMutation.mutate()}
          >
            {t('Claim reward')}
          </Button>
        )}
      </>
    )
  }

  return (
    <div className='mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-16'>
      <TitledCard
        title={campaign?.name || t('Reward')}
        description={
          campaign?.description ||
          t('Claim this reward into your pending Rewards balance.')
        }
        icon={<Gift />}
        iconTone='warning'
      >
        <div className='space-y-4'>{renderCampaignBody()}</div>
      </TitledCard>
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
