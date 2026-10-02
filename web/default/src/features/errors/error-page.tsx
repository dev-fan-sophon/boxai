import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { PageTransition } from '@/components/page-enter'
import { IconBadge } from '@/components/ui/icon-badge'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { cn } from '@/lib/utils'

export type ErrorPageProps = {
  code: string
  title: string
  description: ReactNode
  icon: ReactNode
  iconTone?: 'neutral' | 'destructive' | 'warning' | 'info' | 'success'
  actions?: ReactNode
  /** Compact variant for in-page errors (no hero chrome). */
  minimal?: boolean
  /** Rendered inside the app shell: keep the hero, drop the brand chrome. */
  embedded?: boolean
  className?: string
}

/**
 * Shared full-screen error layout with BoxAI brand chrome.
 * Individual pages only supply code, copy, icon and actions.
 */
export function ErrorPage(props: ErrorPageProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { logo } = useSystemConfig()
  const brandName = status?.system_name || 'BoxAI'
  const iconTone = props.iconTone ?? 'neutral'

  if (props.minimal) {
    return (
      <div
        className={cn(
          'flex min-h-[40vh] w-full flex-col items-center justify-center gap-2 px-4 text-center',
          props.className
        )}
      >
        <p className='font-medium'>{props.title}</p>
        <div className='text-muted-foreground max-w-md text-sm'>
          {props.description}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'bg-background relative isolate flex w-full flex-col overflow-hidden',
        props.embedded ? 'min-h-full' : 'min-h-svh',
        props.className
      )}
    >
      <div
        aria-hidden
        className='playground-discover-hero pointer-events-none absolute inset-0 -z-10'
      />

      {!props.embedded && (
        <header className='flex items-center justify-center px-4 pt-8 sm:pt-10'>
          <Link
            to='/'
            className='text-foreground hover:bg-accent focus-visible:ring-ring/35 inline-flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-sm font-semibold tracking-tight transition-colors outline-none focus-visible:ring-3'
            aria-label={t('Back to Home')}
          >
            <img
              src={logo || '/logo.png'}
              alt=''
              className='ring-border size-7 shrink-0 rounded-lg object-cover ring-1'
            />
            <span className='truncate'>{brandName}</span>
          </Link>
        </header>
      )}

      <main className='flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-16'>
        <PageTransition className='relative w-full max-w-lg text-center'>
          <p
            aria-hidden
            className='text-foreground/[0.04] pointer-events-none absolute inset-x-0 -top-16 -z-10 text-[9rem] leading-none font-bold tracking-tighter tabular-nums select-none sm:-top-24 sm:text-[13rem]'
          >
            {props.code}
          </p>

          <IconBadge
            tone={iconTone}
            size='lg'
            className='ring-border/60 bg-card mx-auto mb-6 size-14 rounded-2xl shadow-sm ring-1 [&>svg]:size-7'
          >
            {props.icon}
          </IconBadge>

          <p className='text-muted-foreground mb-2 text-xs font-medium tabular-nums'>
            {t('Error {{code}}', { code: props.code })}
          </p>

          <h1 className='text-foreground text-2xl font-semibold tracking-tight text-balance sm:text-3xl'>
            {props.title}
          </h1>

          <div className='text-muted-foreground sm:text-md mx-auto mt-3 max-w-md text-sm leading-relaxed text-pretty'>
            {props.description}
          </div>

          {props.actions ? (
            <div className='mt-8 flex flex-wrap items-center justify-center gap-2'>
              {props.actions}
            </div>
          ) : null}
        </PageTransition>
      </main>
    </div>
  )
}
