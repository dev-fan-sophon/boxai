import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useSeo } from '@/hooks/use-page-seo'

import { DocsShell } from './docs-shell'
import { listManifestPages } from './lib/load-doc'

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
  const { t } = useTranslation()
  const pages = listManifestPages()
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
      <h1 className='text-3xl font-bold tracking-tight'>
        {t('Documentation')}
      </h1>
      <p className='text-muted-foreground mt-3 text-lg'>
        {t(
          'Task-oriented guides for BoxAI (you-box.com). Vietnam first, other markets second.'
        )}
      </p>

      <div className='mt-8 grid gap-4 sm:grid-cols-2'>
        {RAILS.map((rail) => (
          <Link
            key={rail.id}
            to='/docs/$'
            params={{ _splat: rail.href }}
            className='hover:bg-muted/40 rounded-xl border p-5 transition-colors'
          >
            <h2 className='text-lg font-semibold'>{t(rail.titleKey)}</h2>
            <p className='text-muted-foreground mt-2 text-sm leading-relaxed'>
              {t(rail.summaryKey)}
            </p>
          </Link>
        ))}
      </div>

      <section className='mt-12'>
        <h2 className='text-xl font-semibold'>{t('Popular guides')}</h2>
        <ul className='mt-4 space-y-2'>
          {startPages.map((page) => (
            <li key={page.path}>
              <Link
                to='/docs/$'
                params={{ _splat: page.path }}
                className='text-primary hover:underline'
              >
                {page.title}
              </Link>
              <p className='text-muted-foreground text-sm'>{page.summary}</p>
            </li>
          ))}
        </ul>
      </section>
    </DocsShell>
  )
}
