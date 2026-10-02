import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ArrowRight,
  Braces,
  LayoutDashboard,
  MessageSquare,
  MonitorSmartphone,
} from '@/components/icons'
import { IconBadge } from '@/components/ui/icon-badge'
import { Eyebrow } from '@/features/home/components/marketing'
import { useSeo } from '@/hooks/use-page-seo'

import { DocsShell } from './docs-shell'
import { listManifestPages } from './lib/load-doc'

const RAIL_ICONS = {
  website: LayoutDashboard,
  api: Braces,
  clients: MonitorSmartphone,
  playground: MessageSquare,
} as const

const RAILS = [
  {
    id: 'website',
    titleKey: 'Use the website',
    summaryKey: 'Create a key, top up, and manage usage in the console.',
    href: 'start/getting-started',
  },
  {
    id: 'api',
    titleKey: 'Integrate the API',
    summaryKey: 'Call the gateway with OpenAI-compatible and other protocols.',
    href: 'api/overview',
  },
  {
    id: 'clients',
    titleKey: 'Install clients',
    summaryKey: 'BoxAI Desktop, Connect, and third-party apps.',
    href: 'clients/desktop',
  },
  {
    id: 'playground',
    titleKey: 'Playground',
    summaryKey: 'Chat and tools in the browser without writing code first.',
    href: 'playground/overview',
  },
] as const

export function DocsHomePage() {
  const { t, i18n } = useTranslation()
  const pages = listManifestPages(i18n.language)
  const connectPages = pages.filter((page) =>
    page.path.startsWith('clients/connect')
  )
  const startPages = pages
    .filter((page) => page.section === 'start')
    .slice(0, 4)

  useSeo(
    useMemo(
      () => ({
        title: t('Documentation'),
        description: t(
          'Guides for BoxAI on you-box.com — console, API, clients, and Playground.'
        ),
      }),
      [t]
    )
  )

  return (
    <DocsShell activePath=''>
      <Eyebrow className='mb-4'>{t('Documentation')}</Eyebrow>
      <h1 className='text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl'>
        {t('Documentation')}
      </h1>
      <p className='text-muted-foreground mt-3 text-base leading-relaxed text-pretty sm:text-lg'>
        {t(
          'Task-oriented guides for BoxAI (you-box.com). Vietnam first, other markets second.'
        )}
      </p>

      <div className='mt-8 grid gap-3 sm:grid-cols-2'>
        {RAILS.map((rail) => {
          const Icon = RAIL_ICONS[rail.id]
          return (
            <Link
              key={rail.id}
              to='/docs/$'
              params={{ _splat: rail.href }}
              data-card-hover='true'
              className='group border-border/60 bg-card hover:border-border hover:shadow-raised transition-ui duration-control flex min-w-0 flex-col rounded-2xl border p-5 shadow-xs'
            >
              <IconBadge tone='primary' size='lg'>
                <Icon weight='duotone' />
              </IconBadge>
              <h2 className='mt-4 flex items-center gap-1.5 text-base font-semibold tracking-tight'>
                {t(rail.titleKey)}
                <ArrowRight
                  className='text-muted-foreground group-hover:text-primary duration-control size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5'
                  aria-hidden='true'
                />
              </h2>
              <p className='text-muted-foreground mt-1.5 text-sm leading-relaxed text-pretty'>
                {t(rail.summaryKey)}
              </p>
            </Link>
          )
        })}
      </div>

      {connectPages.length > 0 && (
        <section className='mt-12'>
          <h2 className='text-lg font-semibold tracking-tight'>
            {t('BoxAI Connect')}
          </h2>
          <ul className='mt-4 grid gap-3 sm:grid-cols-2'>
            {connectPages.map((page) => (
              <li key={page.path} className='min-w-0'>
                <Link
                  to='/docs/$'
                  params={{ _splat: page.path }}
                  className='border-border/60 bg-card hover:border-border hover:bg-accent/40 transition-ui duration-control block h-full rounded-xl border p-4'
                >
                  <h3 className='text-sm font-semibold'>{page.title}</h3>
                  <p className='text-muted-foreground mt-1 text-sm leading-relaxed text-pretty'>
                    {page.summary}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className='mt-12'>
        <h2 className='text-lg font-semibold tracking-tight'>
          {t('Popular guides')}
        </h2>
        <ul className='border-border/60 bg-card mt-4 divide-y overflow-hidden rounded-2xl border'>
          {startPages.map((page) => (
            <li key={page.path}>
              <Link
                to='/docs/$'
                params={{ _splat: page.path }}
                className='group hover:bg-accent/40 transition-ui duration-control flex items-center gap-4 px-5 py-4'
              >
                <span className='min-w-0 flex-1'>
                  <span className='group-hover:text-primary block text-sm font-semibold'>
                    {page.title}
                  </span>
                  <span className='text-muted-foreground mt-0.5 block text-sm text-pretty'>
                    {page.summary}
                  </span>
                </span>
                <ArrowRight
                  className='text-muted-foreground group-hover:text-primary duration-control size-4 shrink-0 transition-transform group-hover:translate-x-0.5'
                  aria-hidden='true'
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </DocsShell>
  )
}
