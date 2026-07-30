/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Braces,
  KeyRound,
  MonitorSmartphone,
  Receipt,
  Shuffle,
  Sparkles,
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { useStatus } from '@/hooks/use-status'
import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'
import { cn } from '@/lib/utils'

/**
 * The product map: BoxAI is a gateway, a browser workspace, and two desktop
 * apps behind one account. Every section below drills into one of the three, so
 * this is the only place that states all of them side by side.
 */
export function Surfaces() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const docsUrl =
    (status?.docs_link as string | undefined) || 'https://docs.newapi.pro'
  const workspaceEnabled = useMemo(
    () =>
      parseHeaderNavModulesFromStatus(status as Record<string, unknown> | null)
        .playground.enabled,
    [status]
  )

  const surfaces = [
    {
      icon: <Braces className='size-5' strokeWidth={1.5} aria-hidden='true' />,
      accent: 'bg-chart-1/10 text-chart-1',
      rule: 'from-chart-1/60',
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
      rule: 'from-chart-10/60',
      title: t('The desktop apps'),
      tagline: t('Your own machine, same account'),
      lines: [
        t('Connect repoints your AI coding clients at BoxAI'),
        t('Desktop runs an AI coworker locally'),
        t('Both sign in from the browser and stay revocable'),
      ],
      cta: t('Learn more'),
      to: '/agents' as const,
    },
  ]

  const ctaClass =
    'group hover:text-primary transition-ui text-foreground mt-6 inline-flex items-center gap-1.5 text-sm font-medium'

  const facts = [
    { icon: Shuffle, label: t('Switch models without a rewrite') },
    { icon: KeyRound, label: t('Keys you can revoke') },
    { icon: Receipt, label: t('Cost you can audit') },
    { icon: Sparkles, label: t('New models as they land') },
  ]

  return (
    <section
      aria-label={t('What you get')}
      className='border-border/40 relative z-10 border-t px-6 py-24 md:py-32'
    >
      <div className='mx-auto max-w-6xl'>
        <AnimateInView className='mb-10 max-w-2xl md:mb-14'>
          <p className='text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase'>
            {t('What you get')}
          </p>
          <h2 className='text-2xl font-bold tracking-tight text-balance md:text-3xl'>
            {t('Three ways in, one account behind them')}
          </h2>
          <p className='text-muted-foreground mt-4 text-sm leading-relaxed text-pretty md:text-base'>
            {t(
              'The same balance, keys, and usage history follow you across all three.'
            )}
          </p>
        </AnimateInView>

        <div className='grid gap-4 md:grid-cols-3'>
          {surfaces.map((surface, index) => (
            <AnimateInView key={surface.title} delay={100 + index * 60}>
              <article
                data-card-hover='true'
                className='border-border/50 bg-card hover:border-border relative flex h-full flex-col overflow-hidden rounded-2xl border p-6 shadow-xs md:p-7'
              >
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-x-0 top-0 h-px bg-gradient-to-r to-transparent',
                    surface.rule
                  )}
                />
                <div
                  className={cn(
                    'mb-5 flex size-11 items-center justify-center rounded-xl',
                    surface.accent
                  )}
                >
                  {surface.icon}
                </div>
                <h3 className='text-lg font-semibold tracking-tight'>
                  {surface.title}
                </h3>
                <p className='text-foreground/80 mt-1.5 text-sm font-medium text-pretty'>
                  {surface.tagline}
                </p>
                <ul className='mt-5 flex-1 space-y-2.5'>
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

        <AnimateInView
          delay={280}
          className='border-border/40 mt-10 grid gap-x-6 gap-y-4 border-t pt-8 sm:grid-cols-2 lg:grid-cols-4'
        >
          {facts.map((fact) => (
            <div key={fact.label} className='flex items-center gap-2.5'>
              <fact.icon
                className='text-muted-foreground size-4 shrink-0'
                strokeWidth={1.5}
                aria-hidden='true'
              />
              <span className='text-sm font-medium'>{fact.label}</span>
            </div>
          ))}
        </AnimateInView>
      </div>
    </section>
  )
}
