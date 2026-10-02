import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Check, Laptop, TriangleAlert } from '@/components/icons'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'

import type { DeviceAuthInfo } from '../types'

export function DeviceAuthRequestCard(props: {
  info: DeviceAuthInfo
  actions?: ReactNode
}) {
  const { t } = useTranslation()
  const permissions = [
    t('Read the models available to your account'),
    t('Call models on your behalf and consume your quota'),
    t('Use a dedicated API key you can revoke any time from the API keys page'),
  ]

  return (
    <Card>
      <CardHeader>
        <IconBadge tone='primary' size='lg' className='mb-2'>
          <Laptop />
        </IconBadge>
        <CardTitle className='break-words'>
          {t('{{client}} wants to access your account', {
            client: props.info.client_name,
          })}
        </CardTitle>
      </CardHeader>

      <CardContent className='space-y-5'>
        <dl className='bg-surface-subtle ring-border/60 divide-border/60 divide-y rounded-xl text-sm ring-1'>
          <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3'>
            <dt className='text-muted-foreground'>{t('Sign-in code')}</dt>
            <dd className='font-mono text-base font-semibold tracking-widest break-all'>
              {props.info.user_code}
            </dd>
          </div>
          <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3'>
            <dt className='text-muted-foreground'>{t('Request origin')}</dt>
            <dd className='min-w-0 font-mono text-xs break-all'>
              {props.info.client_ip || t('Unknown')}
            </dd>
          </div>
        </dl>

        <section>
          <h3 className='mb-2 text-sm font-semibold'>
            {t('Approving will allow it to')}
          </h3>
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

        <CardDescription className='bg-warning-subtle text-warning-subtle-foreground flex gap-2.5 rounded-xl p-3 text-xs'>
          <TriangleAlert className='mt-px size-4 shrink-0' aria-hidden='true' />
          <span className='min-w-0'>
            {t(
              'Only approve if you just started a sign-in from the desktop app and the code matches.'
            )}
          </span>
        </CardDescription>
      </CardContent>

      {props.actions ? (
        <CardFooter className='flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto'>
          {props.actions}
        </CardFooter>
      ) : null}
    </Card>
  )
}
