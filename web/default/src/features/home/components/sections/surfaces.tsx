import { Link } from '@tanstack/react-router'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import {
  ArrowRight,
  BarChart3,
  Braces,
  KeyRound,
  MonitorSmartphone,
  Sparkles,
  WalletCards,
} from '@/components/icons'
import { useStatus } from '@/hooks/use-status'
import { formatCompactNumber } from '@/lib/format'
import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'
import { cn } from '@/lib/utils'

import { useHomeStats } from '../../hooks'
import type { HomeStatsPoint } from '../../types'
import { MarketingSection, SectionIntro } from '../marketing'
import {
  DesktopPreview,
  GatewayPreview,
  WorkspacePreview,
} from '../surface-preview'

/** Thirty daily points drawn into a 96×28 box, normalised to their own peak. */
function TrendSparkline(props: { points: HomeStatsPoint[] }) {
  const path = useMemo(() => {
    const values = props.points.map((point) => point.tokens)
    if (values.length < 2) return ''
    const peak = Math.max(...values, 1)
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 96
        const y = 26 - (value / peak) * 24
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
  }, [props.points])

  if (!path) return null

  return (
    <svg
      viewBox='0 0 96 28'
      className='text-chart-3 h-7 w-24'
      fill='none'
      aria-hidden='true'
    >
      <path
        d={path}
        stroke='currentColor'
        strokeWidth={1.5}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

/**
 * The product map: BoxAI is a gateway, a browser workspace, and desktop apps
 * behind one account. Every section below drills into one of the three, so this
 * is the only place that states all of them side by side — with what the
 * platform actually carries across them: one balance, one set of keys, one
 * usage history.
 */
/** Media creation lives in the studio; fall back to chat when it is off. */
function workspaceTarget(modules: {
  playground: { enabled: boolean }
  create: { enabled: boolean }
}): '/studio' | '/playground' | undefined {
  if (modules.create.enabled) return '/studio'
  if (modules.playground.enabled) return '/playground'
  return undefined
}

export function Surfaces() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const statsQuery = useHomeStats()
  const stats = statsQuery.data?.data
  const docsUrl =
    (status?.docs_link as string | undefined) || 'https://you-box.com'
  const navModules = useMemo(
    () =>
      parseHeaderNavModulesFromStatus(status as Record<string, unknown> | null),
    [status]
  )

  const surfaces = [
    {
      icon: <Braces className='size-5' strokeWidth={1.5} aria-hidden='true' />,
      accent: 'bg-chart-1/10 text-chart-1',
      rule: 'from-chart-1/60',
      preview: <GatewayPreview />,
      title: t('The gateway'),
      tagline: t('One Base URL for every provider you already call'),
      lines: [
        t('OpenAI, Claude, Gemini and Responses formats on one host'),
        t('Any compatible SDK works after changing two settings'),
        t('Automatic failover across the channels behind a model'),
      ],
      cta: t('Read the docs'),
      href: docsUrl,
    },
    {
      icon: (
        <Sparkles className='size-5' strokeWidth={1.5} aria-hidden='true' />
      ),
      accent: 'bg-chart-4/10 text-chart-4',
      rule: 'from-chart-4/60',
      preview: <WorkspacePreview />,
      title: t('The workspace'),
      tagline: t('Chat, images, and video without writing any code'),
      lines: [
        t('Chat with any model in the catalog and switch mid-thread'),
        t('Generate and edit images and video in a continuous feed'),
        t('Start from the inspiration gallery instead of a blank box'),
      ],
      cta: navModules.create.enabled
        ? t('Open the studio')
        : t('Try the Workspace'),
      to: workspaceTarget(navModules),
    },
    {
      icon: (
        <MonitorSmartphone
          className='size-5'
          strokeWidth={1.5}
          aria-hidden='true'
        />
      ),
      accent: 'bg-chart-10/10 text-chart-10',
      rule: 'from-chart-10/60',
      preview: <DesktopPreview />,
      title: t('The desktop apps'),
      tagline: t('Your own machine, same account'),
      lines: [
        t('Connect repoints your AI coding clients at BoxAI'),
        t('Desktop gives an AI agent a workspace for your projects'),
        t('Both sign in from the browser and stay revocable'),
      ],
      cta: t('Learn more'),
      to: '/agents' as const,
    },
  ]

  const ctaClass =
    'group hover:text-primary transition-ui text-foreground mt-6 inline-flex items-center gap-1.5 text-sm font-medium'

  const metrics = [
    {
      value: stats ? formatCompactNumber(stats.available_models) : '—',
      label: t('Models'),
    },
    {
      value: stats ? formatCompactNumber(stats.active_vendors) : '—',
      label: t('Providers'),
    },
    {
      value: stats ? formatCompactNumber(stats.endpoint_types) : '—',
      label: t('API formats'),
    },
    {
      value: stats?.request_count
        ? formatCompactNumber(stats.request_count)
        : '—',
      label: t('Calls in 30 days'),
    },
  ]

  const shared: {
    icon: ReactNode
    title: string
    description: string
    to: '/billing' | '/keys' | '/usage-logs'
    cta: string
    aside?: ReactNode
  }[] = [
    {
      icon: <WalletCards className='size-4' strokeWidth={1.5} />,
      title: t('One balance'),
      description: t(
        'Top up once. The API, the workspace, and the apps all draw from the same wallet.'
      ),
      to: '/billing',
      cta: t('Open Wallet'),
    },
    {
      icon: <KeyRound className='size-4' strokeWidth={1.5} />,
      title: t('One set of keys'),
      description: t(
        'Scope a key per project and revoke it in a click — every surface honours it immediately.'
      ),
      to: '/keys',
      cta: t('Manage keys'),
    },
    {
      icon: <BarChart3 className='size-4' strokeWidth={1.5} />,
      title: t('One usage history'),
      description: t(
        'Every call lands in the same log with its model, tokens, and cost, wherever it came from.'
      ),
      to: '/usage-logs',
      cta: t('View usage'),
      aside: stats?.trend?.length ? (
        <TrendSparkline points={stats.trend} />
      ) : undefined,
    },
  ]

  return (
    <MarketingSection label={t('What you get')}>
      <SectionIntro
        eyebrow={t('What you get')}
        title={t('Three ways in, one account behind them')}
        description={t(
          'The same balance, keys, and usage history follow you across all three.'
        )}
        aside={
          <dl className='border-border/60 grid grid-cols-2 gap-x-6 gap-y-5 border-t pt-6 sm:grid-cols-4 lg:border-t-0 lg:pt-0'>
            {metrics.map((metric) => (
              <div key={metric.label} className='flex min-w-0 flex-col-reverse'>
                <dt className='text-muted-foreground mt-1 text-xs'>
                  {metric.label}
                </dt>
                <dd className='text-2xl font-semibold tracking-tight tabular-nums md:text-3xl'>
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>
        }
      />

      <div className='grid items-stretch gap-4 md:grid-cols-3'>
        {surfaces.map((surface, index) => (
          <AnimateInView
            key={surface.title}
            delay={100 + index * 60}
            className='h-full'
          >
            <article className='border-border/60 bg-card hover:border-border hover:shadow-raised transition-ui duration-control relative flex h-full flex-col overflow-hidden rounded-2xl border p-6 shadow-xs md:p-7'>
              <span
                aria-hidden
                className={cn(
                  'absolute inset-x-0 top-0 h-px bg-gradient-to-r to-transparent',
                  surface.rule
                )}
              />
              <div className='mb-5 flex items-center gap-3'>
                <div
                  className={cn(
                    'flex size-11 items-center justify-center rounded-xl',
                    surface.accent
                  )}
                >
                  {surface.icon}
                </div>
                <h3 className='text-lg font-semibold tracking-tight'>
                  {surface.title}
                </h3>
              </div>

              {surface.preview}

              <p className='text-foreground/80 mt-5 text-sm font-medium text-pretty'>
                {surface.tagline}
              </p>
              <ul className='mt-4 flex-1 space-y-2.5'>
                {surface.lines.map((line) => (
                  <li key={line} className='flex items-start gap-2.5'>
                    <span
                      aria-hidden
                      className='bg-border mt-2 size-1 shrink-0 rounded-full'
                    />
                    <span className='text-muted-foreground text-sm leading-relaxed'>
                      {line}
                    </span>
                  </li>
                ))}
              </ul>
              {surface.href && (
                <a
                  href={surface.href}
                  target='_blank'
                  rel='noopener noreferrer'
                  className={ctaClass}
                >
                  {surface.cta}
                  <ArrowRight className='duration-control size-3.5 transition-transform group-hover:translate-x-0.5' />
                </a>
              )}
              {surface.to && (
                <Link to={surface.to} className={ctaClass}>
                  {surface.cta}
                  <ArrowRight className='duration-control size-3.5 transition-transform group-hover:translate-x-0.5' />
                </Link>
              )}
            </article>
          </AnimateInView>
        ))}
      </div>

      <AnimateInView delay={280} className='mt-4'>
        <div className='border-border/60 bg-surface-sunken/60 rounded-2xl border p-5 sm:p-6 md:p-8'>
          <div className='flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2'>
            <h3 className='text-base font-semibold tracking-tight'>
              {t('What the three share')}
            </h3>
            <p className='text-muted-foreground min-w-0 text-sm text-pretty'>
              {t(
                'Sign in once — nothing has to be set up a second time per surface.'
              )}
            </p>
          </div>

          <div className='mt-6 grid gap-4 md:grid-cols-3'>
            {shared.map((item) => (
              <Link
                key={item.title}
                to={item.to}
                data-card-hover='true'
                className='border-border/50 bg-card hover:border-border group transition-ui flex flex-col rounded-xl border p-5 shadow-xs'
              >
                <div className='flex items-center gap-2.5'>
                  <span className='bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-lg'>
                    {item.icon}
                  </span>
                  <p className='text-sm font-semibold'>{item.title}</p>
                  {item.aside && <span className='ml-auto'>{item.aside}</span>}
                </div>
                <p className='text-muted-foreground mt-3 flex-1 text-sm leading-relaxed text-pretty'>
                  {item.description}
                </p>
                <span className='text-foreground group-hover:text-primary transition-ui mt-4 inline-flex items-center gap-1.5 text-sm font-medium'>
                  {item.cta}
                  <ArrowRight className='duration-control size-3.5 transition-transform group-hover:translate-x-0.5' />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </AnimateInView>
    </MarketingSection>
  )
}
