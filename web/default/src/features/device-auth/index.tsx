import { useMutation, useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ArrowRight,
  CheckCircle2,
  Laptop,
  ShieldAlert,
  XCircle,
} from '@/components/icons'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

import { approveDeviceAuth, getDeviceAuthInfo } from './api'
import { DeviceAuthOutcome } from './components/device-auth-outcome'
import { DeviceAuthRequestCard } from './components/device-auth-request-card'

const routeApi = getRouteApi('/_authenticated/device')

export function DeviceAuthorizePage() {
  const { t } = useTranslation()
  const search = routeApi.useSearch()
  const [userCode, setUserCode] = useState(search.code ?? '')
  const [submittedCode, setSubmittedCode] = useState(search.code ?? '')
  const [outcome, setOutcome] = useState<'approved' | 'denied' | null>(null)

  const infoQuery = useQuery({
    queryKey: ['device-auth-info', submittedCode],
    queryFn: () => getDeviceAuthInfo(submittedCode),
    enabled: submittedCode.length > 0 && outcome === null,
    retry: false,
    staleTime: 0,
  })

  const decision = useMutation({
    mutationFn: (approve: boolean) => approveDeviceAuth(submittedCode, approve),
    onSuccess: (res, approve) => {
      if (res.success) {
        setOutcome(approve ? 'approved' : 'denied')
      }
    },
  })

  if (outcome !== null) {
    return (
      <DeviceAuthShell>
        <DeviceAuthOutcome outcome={outcome} />
      </DeviceAuthShell>
    )
  }

  if (submittedCode.length === 0) {
    return (
      <DeviceAuthShell>
        <Card>
          <form
            className='flex flex-col gap-5'
            onSubmit={(event) => {
              event.preventDefault()
              setSubmittedCode(userCode.trim())
            }}
          >
            <CardHeader>
              <IconBadge tone='primary' size='lg' className='mb-2'>
                <Laptop />
              </IconBadge>
              <CardTitle>
                {t('Enter the code shown in the desktop app')}
              </CardTitle>
              <CardDescription>
                {t(
                  'Only approve if you just started a sign-in from the desktop app and the code matches.'
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-2'>
              <Label htmlFor='device-user-code'>{t('Sign-in code')}</Label>
              <Input
                id='device-user-code'
                autoFocus
                autoComplete='off'
                spellCheck={false}
                placeholder='XXXX-XXXX'
                value={userCode}
                onChange={(event) => setUserCode(event.target.value)}
                className='h-12 text-center font-mono text-lg tracking-[0.2em]'
              />
            </CardContent>
            <CardFooter>
              <Button
                type='submit'
                size='lg'
                className='w-full justify-center'
                disabled={userCode.trim().length === 0}
              >
                {t('Continue')}
                <ArrowRight data-icon='inline-end' />
              </Button>
            </CardFooter>
          </form>
        </Card>
      </DeviceAuthShell>
    )
  }

  if (infoQuery.isLoading) {
    return (
      <DeviceAuthShell>
        <Card aria-busy='true'>
          <CardHeader>
            <Skeleton className='mb-2 size-10 rounded-xl' />
            <Skeleton className='h-5 w-56 max-w-full' />
            <Skeleton className='h-4 w-72 max-w-full' />
          </CardHeader>
          <CardContent className='space-y-3'>
            <Skeleton className='h-16 w-full rounded-xl' />
            <Skeleton className='h-24 w-full rounded-xl' />
          </CardContent>
        </Card>
      </DeviceAuthShell>
    )
  }

  const info = infoQuery.data?.success ? infoQuery.data.data : undefined
  if (!info) {
    const message =
      infoQuery.data?.message ?? t('This sign-in code could not be verified')
    return (
      <DeviceAuthShell>
        <Card>
          <CardHeader>
            <IconBadge tone='destructive' size='lg' className='mb-2'>
              <ShieldAlert />
            </IconBadge>
            <CardTitle className='break-words'>{message}</CardTitle>
          </CardHeader>
          <CardFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                setUserCode('')
                setSubmittedCode('')
              }}
            >
              {t('Try another code')}
            </Button>
          </CardFooter>
        </Card>
      </DeviceAuthShell>
    )
  }

  return (
    <DeviceAuthShell>
      <DeviceAuthRequestCard
        info={info}
        actions={
          <>
            <Button
              type='button'
              variant='outline'
              disabled={decision.isPending}
              onClick={() => decision.mutate(false)}
            >
              <XCircle aria-hidden='true' />
              {t('Deny')}
            </Button>
            <Button
              type='button'
              disabled={decision.isPending}
              onClick={() => decision.mutate(true)}
            >
              <CheckCircle2 aria-hidden='true' />
              {t('Authorize this device')}
            </Button>
          </>
        }
      />
    </DeviceAuthShell>
  )
}

function DeviceAuthShell(props: { children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Desktop sign-in')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto flex w-full max-w-lg flex-col gap-5 py-2 sm:py-6'>
          {props.children}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
