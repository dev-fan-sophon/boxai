import { useMutation, useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import {
  AlertCircle,
  ArrowRight,
  Check,
  Clock,
  Laptop,
  ShieldCheck,
  UserRound,
  X,
} from '@/components/icons'
import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Skeleton } from '@/components/ui/skeleton'
import { useUserDisplay } from '@/hooks/use-user-display'
import { formatDateTimeObject } from '@/lib/time'
import { useAuthStore } from '@/stores/auth-store'

import {
  decideDesktopAuthorization,
  getDesktopAuthorizationRequest,
} from './api'

const routeApi = getRouteApi('/_authenticated/desktop/authorize')

export function DesktopAuthorizationPage() {
  const requestId = routeApi.useSearch().request
  return <AuthorizationPage requestId={requestId} product='desktop' />
}

export function AuthorizationPage(props: {
  requestId?: string
  product: 'desktop' | 'connect'
}) {
  const { t } = useTranslation()
  const requestId = props.requestId
  const user = useAuthStore((state) => state.auth.user)
  const userDisplay = useUserDisplay(user)
  const requestQuery = useQuery({
    queryKey: [props.product, 'authorization-request', requestId],
    queryFn: () =>
      getDesktopAuthorizationRequest(requestId ?? '', props.product),
    enabled: Boolean(requestId),
    retry: false,
  })
  const decision = useMutation({
    mutationFn: (approve: boolean) =>
      decideDesktopAuthorization(requestId ?? '', approve, props.product),
    onSuccess: (result) => window.location.replace(result.redirect_uri),
  })

  const request = requestQuery.data
  const expiresAt = request ? new Date(request.expires_at * 1000) : null
  const expired = expiresAt ? expiresAt.getTime() <= Date.now() : false
  const pending = request?.status.toLowerCase() === 'pending'

  // Three BoxAI desktop products share this page. Naming the wrong one is how a user
  // ends up approving something they did not start, so the copy follows the
  // client that actually opened the request.
  let productName =
    props.product === 'connect' ? 'BoxAI Connect' : 'BoxAI Desktop'
  if (request?.client_id === 'boxai-connect') productName = 'BoxAI Connect'

  let stateMessage: string | null = null
  if (!requestId) stateMessage = t('The authorization request is missing')
  else if (requestQuery.isError) {
    stateMessage = t('The authorization request could not be loaded')
  } else if (expired || request?.status.toLowerCase() === 'expired') {
    stateMessage = t('This authorization request has expired')
  } else if (request && !pending) {
    stateMessage = t('This authorization request has already been decided')
  }

  const permissions = [
    ...(props.product === 'connect'
      ? [t('Create an API key that you can manage in Keys')]
      : []),
    t('Read the models available to your account'),
    t('Call BoxAI models on behalf of your account'),
  ]

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('{{product}} authorization', { product: productName })}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <main
          className='mx-auto flex w-full max-w-lg flex-col gap-5 py-2 sm:py-6'
          aria-live='polite'
        >
          {requestQuery.isLoading && (
            <Card aria-label={t('Loading authorization request')}>
              <CardHeader>
                <Skeleton className='mb-2 h-10 w-28 rounded-xl' />
                <Skeleton className='h-6 w-56 max-w-full' />
                <Skeleton className='h-4 w-72 max-w-full' />
              </CardHeader>
              <CardContent className='space-y-3'>
                <Skeleton className='h-28 w-full rounded-xl' />
                <Skeleton className='h-20 w-full rounded-xl' />
              </CardContent>
            </Card>
          )}
          {!requestQuery.isLoading && stateMessage && (
            <Card>
              <CardContent className='flex flex-col items-center gap-4 py-4 text-center'>
                <IconBadge
                  tone='destructive'
                  size='lg'
                  className='size-14 rounded-2xl [&>svg]:size-7'
                >
                  <AlertCircle />
                </IconBadge>
                <div className='space-y-1.5'>
                  <h2 className='text-lg font-semibold tracking-tight text-balance'>
                    {t('Unable to authorize {{product}}', {
                      product: productName,
                    })}
                  </h2>
                  <p className='text-muted-foreground text-sm text-pretty'>
                    {stateMessage}
                  </p>
                </div>
                <Button variant='outline' render={<Link to='/dashboard' />}>
                  {t('Back to Dashboard')}
                </Button>
              </CardContent>
            </Card>
          )}
          {!requestQuery.isLoading && !stateMessage && request && (
            <Card>
              <CardHeader>
                <div
                  className='mb-2 flex items-center gap-2'
                  aria-hidden='true'
                >
                  <IconBadge tone='primary' size='lg'>
                    <Laptop />
                  </IconBadge>
                  <ArrowRight className='text-muted-foreground size-4' />
                  <IconBadge tone='neutral' size='lg'>
                    <UserRound />
                  </IconBadge>
                </div>
                <CardTitle className='text-balance'>
                  {t('{{product}} wants to access your account', {
                    product: productName,
                  })}
                </CardTitle>
                <CardDescription>
                  {t(
                    'Only approve if you started this request in the desktop app.'
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-5'>
                <dl className='bg-surface-subtle ring-border/60 divide-border/60 divide-y rounded-xl text-sm ring-1'>
                  <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3'>
                    <dt className='text-muted-foreground'>
                      {t('Device name')}
                    </dt>
                    <dd className='min-w-0 font-medium break-words'>
                      {request.client_name}
                    </dd>
                  </div>
                  <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3'>
                    <dt className='text-muted-foreground'>
                      {t('Current account')}
                    </dt>
                    <dd className='min-w-0 font-medium break-words'>
                      {userDisplay.displayName}
                      {userDisplay.secondaryText ? (
                        <span className='text-muted-foreground font-normal'>
                          {` · ${userDisplay.secondaryText}`}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3'>
                    <dt className='text-muted-foreground'>{t('Expires at')}</dt>
                    <dd className='flex items-center gap-1.5 font-medium tabular-nums'>
                      <Clock
                        className='text-muted-foreground size-3.5'
                        aria-hidden='true'
                      />
                      {expiresAt ? formatDateTimeObject(expiresAt) : null}
                    </dd>
                  </div>
                </dl>
                <section aria-labelledby='desktop-permissions-title'>
                  <h2
                    id='desktop-permissions-title'
                    className='mb-2 flex items-center gap-2 text-sm font-semibold'
                  >
                    <ShieldCheck
                      className='text-muted-foreground size-4'
                      aria-hidden='true'
                    />
                    {t('Minimum permissions')}
                  </h2>
                  <ul className='space-y-2 text-sm'>
                    {permissions.map((permission) => (
                      <li key={permission} className='flex gap-2.5'>
                        <Check
                          className='text-success mt-0.5 size-4 shrink-0'
                          aria-hidden='true'
                        />
                        <span className='text-muted-foreground min-w-0'>
                          {permission}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
                {decision.isError ? (
                  <Alert variant='destructive'>
                    <AlertCircle aria-hidden='true' />
                    <AlertTitle>
                      {t('The decision could not be submitted')}
                    </AlertTitle>
                    <AlertDescription>
                      {t('Please try again.')}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
              <CardFooter className='flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto'>
                <Button
                  type='button'
                  variant='outline'
                  disabled={decision.isPending}
                  onClick={() => decision.mutate(false)}
                >
                  <X aria-hidden='true' />
                  {t('Reject')}
                </Button>
                <Button
                  type='button'
                  loading={decision.isPending}
                  disabled={decision.isPending}
                  onClick={() => decision.mutate(true)}
                >
                  <Check aria-hidden='true' />
                  {decision.isPending
                    ? t('Submitting decision...')
                    : t('Approve')}
                </Button>
              </CardFooter>
            </Card>
          )}
        </main>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
