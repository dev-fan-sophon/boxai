import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ArrowRight,
  Braces,
  Clapperboard,
  Layers3,
  Sparkles,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'
import { LobeIcon } from '@/lib/lobe-icon'
import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'

import { useHomeStats } from '../../hooks'
import { HeroGateway } from '../hero-gateway'
import { BrandGlow } from '../marketing'

interface HeroProps {
  className?: string
  isAuthenticated?: boolean
}

export function Hero(props: HeroProps) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const statsQuery = useHomeStats()
  const stats = statsQuery.data?.data

  // The workspace CTA has to follow the same switch as the header link, or the
  // hero sends visitors to a route that redirects them straight back here.
  const workspaceEnabled = useMemo(
    () =>
      parseHeaderNavModulesFromStatus(status as Record<string, unknown> | null)
        .playground.enabled,
    [status]
  )

  const facts = stats
    ? [
        {
          icon: Layers3,
          label: t('{{count}} Available Models', {
            count: stats.available_models,
          }),
        },
        {
          icon: Sparkles,
          label: t('{{count}} Model Providers', {
            count: stats.active_vendors,
          }),
        },
        { icon: Clapperboard, label: t('Text, image, and video') },
      ]
    : [
        { icon: Layers3, label: t('Unified Model Catalog') },
        { icon: Braces, label: t('Unified API Access') },
        { icon: Clapperboard, label: t('Text, image, and video') },
      ]

  const host =
    typeof window === 'undefined' ? 'you-box.com' : window.location.host
  const vendors = stats?.vendors ?? []

  return (
    <section
      aria-label={t('Unified AI gateway, workspace, and desktop apps')}
      className='relative isolate z-10 overflow-hidden px-4 pt-28 pb-16 sm:px-6 sm:pt-36 sm:pb-24'
    >
      <BrandGlow />

      <div className='mx-auto max-w-6xl'>
        <div className='mx-auto flex max-w-3xl flex-col items-center text-center'>
          <Link
            to='/agents'
            className='landing-animate-fade-up group border-border/70 bg-background/70 text-muted-foreground hover:text-foreground hover:border-border transition-ui duration-control mb-6 inline-flex max-w-full items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-xs font-medium opacity-0 shadow-xs backdrop-blur'
          >
            <span className='bg-primary/10 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5'>
              <Sparkles className='size-3' aria-hidden='true' />
              {t('New')}
            </span>
            <span className='min-w-0 truncate'>
              {t('Gateway, workspace, and desktop apps')}
            </span>
            <ArrowRight
              className='duration-control size-3 shrink-0 transition-transform group-hover:translate-x-0.5'
              aria-hidden='true'
            />
          </Link>

          <h1
            className='landing-animate-fade-up text-foreground text-4xl leading-[1.05] font-semibold tracking-tight text-balance opacity-0 sm:text-5xl lg:text-6xl'
            style={{ animationDelay: '60ms' }}
          >
            {t('Every model, one account')}
          </h1>

          <p
            className='landing-animate-fade-up text-muted-foreground mt-5 max-w-2xl text-base leading-relaxed text-pretty opacity-0 sm:text-lg'
            style={{ animationDelay: '120ms' }}
          >
            {t(
              'One unified API, a browser workspace, and desktop apps, all on you-box.com.'
            )}
          </p>

          <div
            className='landing-animate-fade-up mt-8 flex flex-wrap items-center justify-center gap-3 opacity-0'
            style={{ animationDelay: '180ms' }}
          >
            <Button
              variant='cta'
              size='lg'
              className='group h-11 px-6'
              render={
                <Link to={props.isAuthenticated ? '/dashboard' : '/sign-up'} />
              }
            >
              {t('Get Started')}
              <ArrowRight className='duration-control size-4 transition-transform group-hover:translate-x-0.5' />
            </Button>
            <Button
              variant='outline'
              size='lg'
              className='bg-background/70 h-11 px-6 backdrop-blur'
              render={
                workspaceEnabled ? (
                  <Link to='/playground' />
                ) : (
                  <Link to='/pricing' />
                )
              }
            >
              {workspaceEnabled ? t('Try the Workspace') : t('Model Hub')}
            </Button>
          </div>

          <ul
            className='landing-animate-fade-up text-muted-foreground mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm opacity-0'
            style={{ animationDelay: '240ms' }}
          >
            {facts.map((item) => (
              <li key={item.label} className='inline-flex items-center gap-1.5'>
                <item.icon
                  className='text-primary size-4 shrink-0'
                  aria-hidden='true'
                />
                {item.label}
              </li>
            ))}
          </ul>
        </div>

        <div
          className='landing-animate-fade-up relative mx-auto mt-14 max-w-4xl opacity-0 sm:mt-16'
          style={{ animationDelay: '320ms' }}
        >
          <div
            aria-hidden='true'
            className='bg-brand-glow absolute inset-x-8 top-12 -bottom-8 -z-10 rounded-full blur-3xl'
          />
          <HeroGateway models={stats?.top_models ?? []} host={host} />
        </div>

        {vendors.length > 0 && (
          <div
            className='landing-animate-fade-in mt-12 flex flex-col items-center gap-4 opacity-0'
            style={{ animationDelay: '480ms' }}
          >
            <p className='text-muted-foreground text-xs font-medium'>
              {t('Routes to {{count}} providers through one key', {
                count: vendors.length,
              })}
            </p>
            <ul className='flex max-w-3xl flex-wrap items-center justify-center gap-2'>
              {vendors.map((vendor) => (
                <li
                  key={vendor.name}
                  className='border-border/60 bg-background/60 text-foreground/80 inline-flex items-center gap-2 rounded-full border py-1 pr-3 pl-1.5 text-xs font-medium backdrop-blur'
                >
                  <span className='bg-background flex size-5 items-center justify-center rounded-full'>
                    <LobeIcon name={vendor.icon} size={14} />
                  </span>
                  {vendor.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
