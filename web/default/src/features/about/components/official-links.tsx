import { Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  BookOpen,
  ExternalLink,
  Layers3,
  MessageCircle,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { SectionHeading } from '@/components/section-heading'
import { ZALO_COMMUNITY_URL } from '@/components/zalo-community'

type OfficialLink = {
  title: string
  description: string
  icon: ReactNode
  to?: '/pricing' | '/docs/$'
  docsSplat?: string
  href?: string
  external?: boolean
}

function OfficialLinkCard(props: { item: OfficialLink }) {
  const item = props.item
  const className =
    'group border-border/50 bg-card hover:border-border flex h-full items-start gap-4 rounded-2xl border p-5 shadow-xs transition-colors md:p-6'

  const body = (
    <>
      <div className='bg-muted text-foreground/80 flex size-9 shrink-0 items-center justify-center rounded-lg'>
        {item.icon}
      </div>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1.5'>
          <span className='font-semibold tracking-tight'>{item.title}</span>
          <ArrowUpRight
            className='text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100'
            aria-hidden='true'
          />
        </div>
        <p className='text-muted-foreground mt-1 text-sm leading-relaxed text-pretty'>
          {item.description}
        </p>
      </div>
    </>
  )

  if (item.to === '/docs/$' && item.docsSplat) {
    return (
      <Link
        to='/docs/$'
        params={{ _splat: item.docsSplat }}
        className={className}
      >
        {body}
      </Link>
    )
  }

  if (item.to === '/pricing') {
    return (
      <Link to='/pricing' className={className}>
        {body}
      </Link>
    )
  }

  return (
    <a
      href={item.href}
      className={className}
      target={item.external ? '_blank' : undefined}
      rel={item.external ? 'noopener noreferrer' : undefined}
    >
      {body}
    </a>
  )
}

export function OfficialLinks() {
  const { t } = useTranslation()

  const links: OfficialLink[] = [
    {
      title: t('Documentation'),
      description: t(
        'Guides for the console, API, clients, and first successful request.'
      ),
      icon: <BookOpen className='size-4' strokeWidth={1.5} aria-hidden='true' />,
      to: '/docs/$',
      docsSplat: 'start/getting-started',
    },
    {
      title: t('What is BoxAI'),
      description: t(
        'Official product definition, brand, and market positioning.'
      ),
      icon: (
        <ExternalLink className='size-4' strokeWidth={1.5} aria-hidden='true' />
      ),
      to: '/docs/$',
      docsSplat: 'start/what-is-boxai',
    },
    {
      title: t('Model Hub'),
      description: t(
        'Compare models, capabilities, and pricing on the live catalog.'
      ),
      icon: <Layers3 className='size-4' strokeWidth={1.5} aria-hidden='true' />,
      to: '/pricing',
    },
    {
      title: t('Zalo Community'),
      description: t(
        'Get product updates, support, and connect with BoxAI users in Vietnam.'
      ),
      icon: (
        <MessageCircle className='size-4' strokeWidth={1.5} aria-hidden='true' />
      ),
      href: ZALO_COMMUNITY_URL,
      external: true,
    },
  ]

  return (
    <section
      aria-labelledby='about-links-title'
      className='border-border/40 relative z-10 border-t px-6 py-20 md:py-28'
    >
      <div className='mx-auto max-w-6xl'>
        <SectionHeading
          id='about-links-title'
          eyebrow={t('Official links')}
          title={t('Where to go next')}
          description={t(
            'Canonical entry points for docs, models, and community — all on you-box.com unless noted.'
          )}
        />

        <div className='grid gap-3 sm:grid-cols-2'>
          {links.map((item, index) => (
            <AnimateInView key={item.title} delay={index * 50}>
              <OfficialLinkCard item={item} />
            </AnimateInView>
          ))}
        </div>
      </div>
    </section>
  )
}
