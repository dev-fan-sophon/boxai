import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import {
  ArrowRight,
  KeyRound,
  Layers3,
  PlugZap,
  WalletCards,
} from '@/components/icons'
import { useStatus } from '@/hooks/use-status'
import { cn } from '@/lib/utils'

import { useHomeStats } from '../../hooks'
import { ConsolePreview, type ConsoleStep } from '../console-preview'
import { MarketingSection, SectionIntro } from '../marketing'

/** How long a step stays on screen before the walkthrough moves itself on. */
const STEP_DWELL_MS = 6000

const STEP_ORDER: ConsoleStep[] = ['wallet', 'keys', 'models', 'integrate']

export function HowItWorks() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const statsQuery = useHomeStats()
  const stats = statsQuery.data?.data
  const docsUrl =
    (status?.docs_link as string | undefined) || 'https://you-box.com'
  const [active, setActive] = useState<ConsoleStep>('wallet')
  // Once the visitor picks a step, the tour stops driving the preview out from
  // under them.
  const [pinned, setPinned] = useState(false)

  const steps = [
    {
      id: 'wallet' as const,
      num: '01',
      title: t('Top Up Account'),
      desc: t(
        'Go to Wallet and choose an available payment method and amount.'
      ),
      href: '/billing',
      icon: <WalletCards className='size-5' strokeWidth={1.5} />,
    },
    {
      id: 'keys' as const,
      num: '02',
      title: t('Create API Key'),
      desc: t(
        'Create keys in API Tokens, split by project, rotate anytime to reduce leak risk.'
      ),
      href: '/keys',
      icon: <KeyRound className='size-5' strokeWidth={1.5} />,
    },
    {
      id: 'models' as const,
      num: '03',
      title: t('Choose Models'),
      desc: t(
        'Browse capabilities, pricing, and context length in Model Hub, then copy the model name to call.'
      ),
      href: '/pricing',
      icon: <Layers3 className='size-5' strokeWidth={1.5} />,
    },
    {
      id: 'integrate' as const,
      num: '04',
      title: t('Integrate Apps'),
      desc: t(
        'Compatible SDKs typically require only the platform Base URL and API key.'
      ),
      href: docsUrl,
      external: docsUrl.startsWith('http'),
      icon: <PlugZap className='size-5' strokeWidth={1.5} />,
    },
  ]

  useEffect(() => {
    if (pinned) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const id = setInterval(() => {
      setActive((current) => {
        const next = STEP_ORDER.indexOf(current) + 1
        return STEP_ORDER[next % STEP_ORDER.length]
      })
    }, STEP_DWELL_MS)
    return () => clearInterval(id)
  }, [pinned])

  const host =
    typeof window === 'undefined' ? 'you-box.com' : window.location.host

  return (
    <MarketingSection
      label={t('Quick start and platform capabilities')}
      tone='muted'
    >
      <SectionIntro
        eyebrow={t('Quick Start')}
        title={t('One unified API for the models currently available')}
        description={t(
          'Four screens in the console take you from an empty account to a working call.'
        )}
      />

      <div className='grid items-start gap-8 lg:grid-cols-12 lg:gap-10'>
        <div className='space-y-2 lg:col-span-5'>
          {steps.map((step, index) => {
            const isActive = step.id === active
            return (
              <AnimateInView key={step.id} delay={100 + index * 70}>
                <div
                  className={cn(
                    'transition-ui duration-control rounded-2xl border p-4',
                    isActive
                      ? 'border-border bg-card shadow-raised'
                      : 'hover:bg-card/60 border-transparent'
                  )}
                >
                  <button
                    type='button'
                    onClick={() => {
                      setActive(step.id)
                      setPinned(true)
                    }}
                    aria-pressed={isActive}
                    className='flex w-full items-center gap-3 text-left'
                  >
                    <span
                      className={cn(
                        'transition-ui duration-control flex size-10 shrink-0 items-center justify-center rounded-xl border',
                        isActive
                          ? 'border-primary/30 bg-primary/10 text-primary'
                          : 'border-border/60 bg-background text-muted-foreground'
                      )}
                    >
                      {step.icon}
                    </span>
                    <span className='min-w-0'>
                      <span className='flex items-center gap-2'>
                        <span className='text-muted-foreground text-2xs font-mono'>
                          {step.num}
                        </span>
                        <span className='text-sm font-semibold'>
                          {step.title}
                        </span>
                      </span>
                    </span>
                  </button>

                  <p className='text-muted-foreground mt-3 text-sm leading-relaxed'>
                    {step.desc}
                  </p>

                  {step.external ? (
                    <a
                      href={step.href}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='group text-foreground hover:text-primary transition-ui mt-3 inline-flex items-center gap-1.5 text-sm font-medium'
                    >
                      {t('Read the docs')}
                      <ArrowRight className='duration-control size-3.5 transition-transform group-hover:translate-x-0.5' />
                    </a>
                  ) : (
                    <Link
                      to={step.href}
                      className='group text-foreground hover:text-primary transition-ui mt-3 inline-flex items-center gap-1.5 text-sm font-medium'
                    >
                      {t('Open in console')}
                      <ArrowRight className='duration-control size-3.5 transition-transform group-hover:translate-x-0.5' />
                    </Link>
                  )}
                </div>
              </AnimateInView>
            )
          })}
        </div>

        <AnimateInView
          delay={140}
          animation='fade-left'
          className='lg:sticky lg:top-24 lg:col-span-7'
        >
          <ConsolePreview
            step={active}
            host={host}
            models={stats?.top_models ?? []}
            modelCount={stats?.available_models}
            vendorCount={stats?.active_vendors}
          />
        </AnimateInView>
      </div>
    </MarketingSection>
  )
}
