import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Coins, Layers, ShieldCheck } from '@/components/icons'
import { LanguageSwitcher } from '@/components/language-switcher'
import { FadeIn, PageTransition } from '@/components/page-enter'
import { ThemeSwitch } from '@/components/theme-switch'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useSystemConfig } from '@/hooks/use-system-config'

type AuthLayoutProps = {
  children: ReactNode
  /** Page heading rendered above the form. */
  title?: ReactNode
  /** Supporting copy under the heading (links allowed). */
  description?: ReactNode
  /** Optional illustrative tile shown above the heading. */
  icon?: ReactNode
}

/**
 * Split auth shell: brand panel on wide screens, focused form column
 * everywhere. Pages supply the heading through `title` / `description` so
 * every auth screen shares one rhythm.
 */
export function AuthLayout(props: AuthLayoutProps) {
  const { t } = useTranslation()
  const { systemName, logo, loading } = useSystemConfig()

  const brand = (
    <Link
      to='/'
      className='focus-visible:ring-ring/35 flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3'
    >
      <span className='relative size-8 shrink-0'>
        {loading ? (
          <Skeleton className='absolute inset-0 rounded-lg' />
        ) : (
          <img
            src={logo}
            alt={t('Logo')}
            className='ring-border size-8 rounded-lg object-cover ring-1'
          />
        )}
      </span>
      {loading ? (
        <Skeleton className='h-5 w-24' />
      ) : (
        <span className='truncate text-base font-semibold tracking-tight'>
          {systemName}
        </span>
      )}
    </Link>
  )

  const highlights = [
    { icon: <Layers />, label: t('One API key for every major AI provider') },
    { icon: <Coins />, label: t('Clear usage and billing in one place') },
    {
      icon: <ShieldCheck />,
      label: t('Passkeys and two-factor sign-in keep your account safe'),
    },
  ]

  return (
    <div className='bg-background relative flex min-h-svh w-full'>
      <aside className='hidden w-[min(44%,36rem)] shrink-0 p-3 lg:flex'>
        <div className='playground-discover-hero bg-surface-sunken ring-border/60 shadow-panel relative flex w-full flex-col justify-between gap-10 overflow-hidden rounded-3xl p-10 ring-1'>
          <div
            aria-hidden
            className='bg-brand-glow pointer-events-none absolute -bottom-32 -left-24 size-96 rounded-full blur-3xl'
          />
          {brand}

          <FadeIn className='relative max-w-md space-y-8'>
            <div className='space-y-3'>
              <h2 className='text-3xl font-semibold tracking-tight text-balance'>
                {t('One account for every AI model')}
              </h2>
              <p className='text-muted-foreground text-md text-pretty'>
                {t(
                  'Sign in once to use the API, the web workspace and the BoxAI desktop apps.'
                )}
              </p>
            </div>
            <ul className='space-y-3'>
              {highlights.map((item) => (
                <li key={item.label} className='flex items-center gap-3'>
                  <IconBadge tone='primary' size='md'>
                    {item.icon}
                  </IconBadge>
                  <span className='min-w-0 text-sm font-medium'>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
          </FadeIn>

          <p className='text-muted-foreground relative text-xs'>
            © {new Date().getFullYear()} {systemName}
          </p>
        </div>
      </aside>

      <div className='flex min-w-0 flex-1 flex-col'>
        <header className='flex items-center justify-between gap-3 px-4 pt-4 sm:px-8 sm:pt-6'>
          <div className='min-w-0 lg:invisible'>{brand}</div>
          <div className='flex shrink-0 items-center gap-1'>
            <LanguageSwitcher />
            <ThemeSwitch />
          </div>
        </header>

        <main className='flex flex-1 items-start justify-center px-4 pt-10 pb-12 sm:items-center sm:px-8 sm:py-12'>
          <PageTransition className='w-full max-w-[25rem]'>
            {(props.title || props.description || props.icon) && (
              <div className='mb-8 space-y-2'>
                {props.icon ? <div className='mb-5'>{props.icon}</div> : null}
                {props.title ? (
                  <h1 className='text-2xl font-semibold tracking-tight text-balance'>
                    {props.title}
                  </h1>
                ) : null}
                {props.description ? (
                  <div className='text-muted-foreground space-y-1.5 text-sm text-pretty'>
                    {props.description}
                  </div>
                ) : null}
              </div>
            )}
            {props.children}
          </PageTransition>
        </main>
      </div>
    </div>
  )
}
