/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, MonitorSmartphone, RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import { revokeDesktopSession } from '@/features/profile/api'
import type { DesktopSession } from '@/features/profile/types'
import { toIntlLocale } from '@/i18n/languages'

import { clientAppSessionsQueryKey } from '../hooks/use-client-app-sessions'

export function ClientAppSessionsCard(props: {
  appName: string
  sessions: DesktopSession[]
  loading: boolean
  failed: boolean
  fetching: boolean
  onRefresh: () => void
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [sessionToRevoke, setSessionToRevoke] = useState<DesktopSession | null>(
    null
  )

  const revokeMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await revokeDesktopSession(sessionId)
      if (!response.success) throw new Error(response.message)
    },
    onSuccess: async () => {
      setSessionToRevoke(null)
      toast.success(t('Desktop session revoked'))
      await queryClient.invalidateQueries({
        queryKey: clientAppSessionsQueryKey,
      })
      await queryClient.invalidateQueries({
        queryKey: ['profile', 'desktop-sessions'],
      })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const formatDate = (value: number) => {
    const date = new Date(value * 1000)
    if (Number.isNaN(date.getTime())) return '—'
    // i18n uses project codes like `zhCN`; Intl requires BCP-47 (`zh-CN`).
    return new Intl.DateTimeFormat(
      toIntlLocale(i18n.resolvedLanguage || i18n.language),
      { dateStyle: 'medium', timeStyle: 'short' }
    ).format(date)
  }

  let content: ReactNode = (
    <ul className='space-y-2' aria-label={t('Connected devices')}>
      {props.sessions.map((session) => (
        <li
          key={session.id}
          className='bg-muted/40 flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between'
        >
          <div className='min-w-0'>
            <p className='truncate text-sm font-medium'>
              {session.client_name}
            </p>
            <p className='text-muted-foreground mt-0.5 text-xs'>
              {t('Last active {{time}}', {
                time: formatDate(session.last_refreshed_at),
              })}
            </p>
          </div>
          <Button
            variant='outline'
            size='sm'
            className='shrink-0'
            onClick={() => setSessionToRevoke(session)}
          >
            {t('Revoke')}
          </Button>
        </li>
      ))}
    </ul>
  )

  if (props.loading) {
    content = (
      <div className='space-y-2' aria-busy='true'>
        <Skeleton className='h-16 w-full' />
        <Skeleton className='h-16 w-full' />
      </div>
    )
  } else if (props.failed) {
    content = (
      <p className='text-muted-foreground py-4 text-center text-sm'>
        {t('Unable to load desktop sessions.')}
      </p>
    )
  } else if (props.sessions.length === 0) {
    content = (
      <div className='py-4 text-center'>
        <p className='text-sm font-medium'>{t('No device connected yet')}</p>
        <p className='text-muted-foreground mt-1 text-xs'>
          {t(
            'Install {{product}} and sign in — this device will show up here.',
            {
              product: props.appName,
            }
          )}
        </p>
      </div>
    )
  }

  return (
    <>
      <TitledCard
        title={t('Connected devices')}
        description={t('Every signed-in install can be revoked from here.')}
        icon={<MonitorSmartphone aria-hidden='true' />}
        iconTone='info'
        disableHoverEffect
        action={
          <Button
            variant='outline'
            size='sm'
            className='w-full sm:w-auto'
            onClick={props.onRefresh}
            disabled={props.fetching}
          >
            <RefreshCw
              aria-hidden='true'
              className={props.fetching ? 'animate-spin' : undefined}
            />
            {props.fetching ? t('Refreshing...') : t('Refresh')}
          </Button>
        }
      >
        {content}
      </TitledCard>

      <AlertDialog
        open={sessionToRevoke !== null}
        onOpenChange={(open) => !open && setSessionToRevoke(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Revoke desktop session?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('This device will be signed out and its key disabled.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeMutation.isPending}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={revokeMutation.isPending}
              onClick={(event) => {
                event.preventDefault()
                if (sessionToRevoke) revokeMutation.mutate(sessionToRevoke.id)
              }}
            >
              {revokeMutation.isPending && (
                <Loader2 aria-hidden='true' className='animate-spin' />
              )}
              {t('Revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
