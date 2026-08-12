import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Braces,
  MonitorSmartphone,
  Sparkles,
} from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { SectionHeading } from '@/components/section-heading'
import { useStatus } from '@/hooks/use-status'
import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'
import { cn } from '@/lib/utils'

type GlanceCard = {
  icon: ReactNode
  accent: string
  title: string
  tagline: string
  lines: string[]
  cta: string
  to?: '/playground' | '/agents' | '/docs/$'
  docsSplat?: string
  href?: string
}

function GlanceCta(props: { card: GlanceCard; className: string }) {
  const card = props.card
  const arrow = (
    <ArrowRight className='duration-control size-3.5 transition-transform group-hover:translate-x-0.5' />
  )

  if (card.to === '/docs/$' && card.docsSplat) {
    return (
      <Link
        to='/docs/$'
        params={{ _splat: card.docsSplat }}
        className={props.className}
      >
        {card.cta}
        {arrow}
      </Link>
    )
  }

  if (card.to === '/playground' || card.to === '/agents') {
    return (
      <Link to={card.to} className={props.className}>
        {card.cta}
        {arrow}
      </Link>
    )
  }

  if (card.href) {
    return (
      <a
        href={card.href}
        className={props.className}
        target='_blank'
        rel='noopener noreferrer'
      >
        {card.cta}
        {arrow}
      </a>
    )
  }

  return null
}

export function ProductGlance() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const workspaceEnabled = useMemo(
    () =>
      parseHeaderNavModulesFromStatus(status as Record<string, unknown> | null)
        .playground.enabled,
    [status]
  )
  const docsUrl =
    (status?.docs_link as string | undefined) || '/docs/start/getting-started'
  const docsIsExternal = /^https?:\/\//i.test(docsUrl)

  const cards: GlanceCard[] = [
    {
      icon: <Braces className='size-5' strokeWidth={1.5} aria-hidden='true' />,
      accent: 'bg-chart-1/10 text-chart-1',
      title: t('The gateway'),
      tagline: t('One Base URL for every provider you already call'),
      lines: [
        t('OpenAI, Claude, Gemini and Responses formats on one host'),
        t('Any compatible SDK works after changing two settings'),
        t('Automatic failover across the channels behind a model'),
      ],
      cta: t('Read the docs'),
      ...(docsIsExternal
        ? { href: docsUrl }
        : {
            to: '/docs/$' as const,
            docsSplat: 'start/getting-started',
          }),
    },
    {
      icon: (
        <Sparkles className='size-5' strokeWidth={1.5} aria-hidden='true' />
      ),
      accent: 'bg-chart-4/10 text-chart-4',
      title: t('The workspace'),
      tagline: t('Chat, images, and video without writing any code'),
      lines: [
        t('Chat with any model in the catalog and switch mid-thread'),
        t('Generate and edit images and video in a continuous feed'),
        t('Start from the inspiration gallery instead of a blank box'),
      ],
      cta: t('Try the Workspace'),
      to: workspaceEnabled ? ('/playground' as const) : undefined,
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
      title: t('The desktop apps'),
      tagline: t('Your own machine, same account'),
      lines: [
        t('Connect repoints your AI coding clients at BoxAI'),
        t('Desktop turns everyday office work into finished files'),
        t('Both sign in from the browser and stay revocable'),
      ],
      cta: t('Learn more'),
      to: '/agents' as const,
    },
  ]

  const ctaClass =
    'group hover:text-primary transition-ui text-foreground mt-6 inline-flex items-center gap-1.5 text-sm font-medium'

  return (
    <section
      aria-labelledby='about-product-title'
      className='border-border/40 relative z-10 border-t px-6 py-20 md:py-28'
    >
      <div className='mx-auto max-w-6xl'>
        <SectionHeading
          id='about-product-title'
          eyebrow={t('Product')}
          title={t('Three ways in, one account behind them')}
          description={t(
            'The same balance, keys, and usage history follow you across the API gateway, browser workspace, and desktop apps.'
          )}
        />

        <div className='grid gap-5 md:grid-cols-3'>
          {cards.map((card, index) => (
            <AnimateInView key={card.title} delay={index * 80} className='h-full'>
              <article
                data-card-hover='true'
                className='border-border/50 bg-card hover:border-border flex h-full flex-col rounded-2xl border p-6 shadow-xs md:p-7'
              >
                <div
                  className={cn(
                    'mb-4 inline-flex size-10 items-center justify-center rounded-xl',
                    card.accent
                  )}
                >
                  {card.icon}
                </div>
                <h3 className='text-lg font-semibold tracking-tight'>
                  {card.title}
                </h3>
                <p className='text-muted-foreground mt-1.5 text-sm leading-relaxed text-pretty'>
                  {card.tagline}
                </p>
                <ul className='text-muted-foreground mt-5 space-y-2.5 text-sm leading-relaxed'>
                  {card.lines.map((line) => (
                    <li key={line} className='flex gap-2'>
                      <span
                        className='bg-foreground/40 mt-2 size-1 shrink-0 rounded-full'
                        aria-hidden='true'
                      />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                {(card.to || card.href) && (
                  <div className='mt-auto'>
                    <GlanceCta card={card} className={ctaClass} />
                  </div>
                )}
              </article>
            </AnimateInView>
          ))}
        </div>
      </div>
    </section>
  )
}
