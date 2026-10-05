import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Gift, Mail } from '@/components/icons'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Turnstile } from '@/components/turnstile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { TitledCard } from '@/components/ui/titled-card'
import { useCountdown } from '@/hooks/use-countdown'
import { formatQuota } from '@/lib/format'

import { useTurnstile } from '../../auth/hooks/use-turnstile'
import {
  getTrialCredit,
  requestTrialCredit,
  sendTrialVerification,
} from '../api'
import { BILLING_QUERY_KEYS } from '../constants'
import {
  isTrialGrantExpired,
  normalizeTrialVerificationCode,
} from '../lib/trial-credit'
import type { TrialCreditData, TrialGrantStatus } from '../types'

const statusVariants: Record<TrialGrantStatus, StatusVariant> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  suspended: 'danger',
}

const statusLabels: Record<TrialGrantStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
}

export function TrialCreditCard() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const countdown = useCountdown({ initialSeconds: 60 })
  const turnstile = useTurnstile()

  const trialQuery = useQuery({
    queryKey: BILLING_QUERY_KEYS.trial,
    queryFn: async () => {
      const response = await getTrialCredit()
      if (!response.success || !response.data) {
        throw new Error(response.message || t('Failed to load trial credit'))
      }
      return response.data
    },
    retry: false,
  })

  const verificationMutation = useMutation({
    mutationFn: () => sendTrialVerification(turnstile.turnstileToken),
    onSuccess: (response) => {
      if (!response.success) {
        toast.error(response.message || t('Failed to send verification code'))
        return
      }
      countdown.start(60)
      toast.success(t('Verification code sent to your current email'))
    },
    onError: () => toast.error(t('Failed to send verification code')),
    onSettled: turnstile.resetTurnstile,
  })

  const requestMutation = useMutation({
    mutationFn: () => requestTrialCredit(code, turnstile.turnstileToken),
    onSuccess: (response) => {
      if (!response.success || !response.data) {
        toast.error(response.message || t('Failed to request trial credit'))
        return
      }
      queryClient.setQueryData<TrialCreditData>(
        BILLING_QUERY_KEYS.trial,
        (old) => (old ? { ...old, grant: response.data ?? null } : old)
      )
      setCode('')
      toast.success(t('Trial credit request submitted for review'))
    },
    onError: () => toast.error(t('Failed to request trial credit')),
    onSettled: turnstile.resetTurnstile,
  })

  const data = trialQuery.data
  if (!data || (!data.enabled && !data.grant)) return null

  const grant = data.grant
  const grantExpired = grant ? isTrialGrantExpired(grant) : false
  const usagePercent = grant?.total
    ? Math.min(100, Math.max(0, (grant.used / grant.total) * 100))
    : 0

  return (
    <TitledCard
      title={t('Trial credit')}
      description={t('Trial credit is separate from your paid wallet balance')}
      icon={<Gift className='size-4' />}
      iconTone='info'
      disableHoverEffect
      contentClassName='space-y-4'
      action={
        grant ? (
          <StatusBadge
            label={grantExpired ? t('Expired') : t(statusLabels[grant.status])}
            variant={grantExpired ? 'danger' : statusVariants[grant.status]}
            copyable={false}
          />
        ) : undefined
      }
    >
      {grant?.status === 'approved' && (
        <div className='space-y-4'>
          {grantExpired && (
            <p className='text-destructive text-sm font-medium'>
              {t('This trial credit has expired and can no longer be used.')}
            </p>
          )}
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
            <TrialAmount label={t('Remaining')} value={grant.remaining} />
            <TrialAmount label={t('Used')} value={grant.used} />
            <TrialAmount label={t('Reserved')} value={grant.reserved} />
            <TrialAmount label={t('Total')} value={grant.total} />
          </div>
          <Progress value={usagePercent} className='h-1.5' />
          <div className='space-y-1.5 text-xs'>
            <p className='text-muted-foreground'>
              {t('Expires at')}:{' '}
              <span className='text-foreground font-medium'>
                {new Date(grant.expires_at * 1000).toLocaleString(
                  i18n.language
                )}
              </span>
            </p>
            <div className='flex flex-wrap items-center gap-1.5'>
              <span className='text-muted-foreground'>
                {t('Allowed models')}:
              </span>
              {grant.models.map((model) => (
                <Badge key={model} variant='outline'>
                  {model}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className='text-muted-foreground space-y-1 text-xs'>
        <p>
          {t(
            'Trial credit supports single text generations without tools. Set an explicit output token limit.'
          )}{' '}
          {t('Max output tokens')}: {data.max_output_tokens}
        </p>
        <p>
          {t(
            'Trial credit is used only when your paid wallet is empty and you have no paid subscription.'
          )}
        </p>
        <p>
          {t('Async media tasks require paid wallet or subscription funding.')}
        </p>
      </div>

      {grant?.status === 'pending' && (
        <p className='text-muted-foreground text-sm'>
          {t(
            'Your trial credit request is pending manual review. Contact support if you need help.'
          )}
        </p>
      )}

      {(!data.enabled ||
        grant?.status === 'rejected' ||
        grant?.status === 'suspended') && (
        <p className='text-muted-foreground text-sm'>
          {t(
            'This trial credit is unavailable. Please contact support for help.'
          )}
        </p>
      )}

      {!grant && !data.eligible && (
        <p className='text-muted-foreground text-sm'>
          {t('This account is not eligible for trial credit.')}
        </p>
      )}

      {!grant && data.enabled && data.eligible && !data.email && (
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Bind an email in account settings before requesting trial credit.'
            )}
          </p>
          <Button variant='outline' size='sm' render={<Link to='/profile' />}>
            {t('Account settings')}
          </Button>
        </div>
      )}

      {!grant && data.enabled && data.eligible && data.email && (
        <div className='space-y-3'>
          <div className='bg-muted/40 flex items-center gap-2 rounded-lg border p-3 text-sm'>
            <Mail className='text-muted-foreground size-4 shrink-0' />
            <span className='truncate'>{data.email}</span>
          </div>
          <div className='flex flex-col gap-2 sm:flex-row'>
            <Input
              value={code}
              onChange={(event) =>
                setCode(normalizeTrialVerificationCode(event.target.value))
              }
              maxLength={6}
              inputMode='text'
              pattern='[A-Fa-f0-9]{6}'
              autoComplete='one-time-code'
              aria-label={t('Verification code')}
              placeholder={t('Verification code')}
            />
            <Button
              variant='outline'
              className='sm:w-40'
              disabled={
                countdown.isActive ||
                verificationMutation.isPending ||
                requestMutation.isPending
              }
              onClick={() => {
                if (turnstile.validateTurnstile()) verificationMutation.mutate()
              }}
            >
              {countdown.isActive
                ? t('Send again in {{seconds}}s', {
                    seconds: countdown.secondsLeft,
                  })
                : t('Send code')}
            </Button>
            <Button
              className='sm:w-40'
              disabled={
                code.length !== 6 ||
                requestMutation.isPending ||
                verificationMutation.isPending
              }
              onClick={() => {
                if (turnstile.validateTurnstile()) requestMutation.mutate()
              }}
            >
              {t('Request review')}
            </Button>
          </div>
          <p className='text-muted-foreground text-xs'>
            {t(
              'A verification code will be sent to your current bound email. Requests are reviewed manually.'
            )}
          </p>
          {turnstile.isTurnstileEnabled && (
            <Turnstile
              key={turnstile.turnstileWidgetKey}
              siteKey={turnstile.turnstileSiteKey}
              onVerify={turnstile.setTurnstileToken}
              onExpire={turnstile.resetTurnstile}
            />
          )}
        </div>
      )}
    </TitledCard>
  )
}

function TrialAmount(props: { label: string; value: number }) {
  return (
    <div className='rounded-lg border p-3'>
      <p className='text-muted-foreground text-xs'>{props.label}</p>
      <p className='mt-1 font-semibold tabular-nums'>
        {formatQuota(props.value)}
      </p>
    </div>
  )
}
