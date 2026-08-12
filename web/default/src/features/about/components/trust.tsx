import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  KeyRound,
  Layers3,
  Scale,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { SectionHeading } from '@/components/section-heading'
import { useHomeStats } from '@/features/home/hooks'
import { formatCompactNumber } from '@/lib/format'

export function Trust() {
  const { t } = useTranslation()
  const statsQuery = useHomeStats()
  const stats = statsQuery.data?.data

  const principles = [
    {
      icon: (
        <Layers3 className='size-4' strokeWidth={1.5} aria-hidden='true' />
      ),
      title: t('Multi-provider catalog'),
      description: t(
        'Browse models and capabilities in one Model Hub instead of juggling separate vendor consoles.'
      ),
    },
    {
      icon: (
        <WalletCards className='size-4' strokeWidth={1.5} aria-hidden='true' />
      ),
      title: t('One balance'),
      description: t(
        'Top up once. The API, the workspace, and the apps all draw from the same wallet.'
      ),
    },
    {
      icon: (
        <KeyRound className='size-4' strokeWidth={1.5} aria-hidden='true' />
      ),
      title: t('One set of keys'),
      description: t(
        'Scope a key per project and revoke it in a click — every surface honours it immediately.'
      ),
    },
    {
      icon: (
        <ShieldCheck className='size-4' strokeWidth={1.5} aria-hidden='true' />
      ),
      title: t('Usage you can audit'),
      description: t(
        'Every call lands in the same log with its model, tokens, and cost, wherever it came from.'
      ),
    },
  ]

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
  ]

  return (
    <section
      aria-labelledby='about-trust-title'
      className='border-border/40 relative z-10 border-t px-6 py-20 md:py-28'
    >
      <div className='mx-auto max-w-6xl'>
        <SectionHeading
          id='about-trust-title'
          eyebrow={t('Trust')}
          title={t('How BoxAI operates')}
          description={t(
            'A single account for access, billing, and history — with clear legal terms and a Vietnam-oriented operating baseline.'
          )}
        />

        <div className='mb-10 grid grid-cols-3 gap-3 sm:gap-4 md:mb-12'>
          {metrics.map((metric, index) => (
            <AnimateInView key={metric.label} delay={index * 50}>
              <div className='border-border/50 bg-card rounded-2xl border px-4 py-5 text-center shadow-xs sm:px-6'>
                <p className='text-2xl font-semibold tracking-tight tabular-nums md:text-3xl'>
                  {metric.value}
                </p>
                <p className='text-muted-foreground mt-1 text-xs font-medium tracking-wide uppercase sm:text-sm'>
                  {metric.label}
                </p>
              </div>
            </AnimateInView>
          ))}
        </div>

        <div className='grid gap-4 sm:grid-cols-2'>
          {principles.map((item, index) => (
            <AnimateInView key={item.title} delay={index * 40}>
              <article className='border-border/50 bg-card flex h-full gap-4 rounded-2xl border p-5 shadow-xs md:p-6'>
                <div className='bg-muted text-foreground/80 flex size-9 shrink-0 items-center justify-center rounded-lg'>
                  {item.icon}
                </div>
                <div className='min-w-0'>
                  <h3 className='font-semibold tracking-tight'>{item.title}</h3>
                  <p className='text-muted-foreground mt-1.5 text-sm leading-relaxed text-pretty'>
                    {item.description}
                  </p>
                </div>
              </article>
            </AnimateInView>
          ))}
        </div>

        <AnimateInView className='border-border/50 bg-muted/30 mt-8 flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between md:p-6'>
          <div className='flex gap-3'>
            <div className='bg-background text-foreground/80 flex size-9 shrink-0 items-center justify-center rounded-lg border'>
              <Scale className='size-4' strokeWidth={1.5} aria-hidden='true' />
            </div>
            <div>
              <p className='font-semibold tracking-tight'>
                {t('Legal and compliance')}
              </p>
              <p className='text-muted-foreground mt-1 text-sm leading-relaxed text-pretty'>
                {t(
                  'Review the Privacy Policy and User Agreement for how we handle data and acceptable use. Business operations use the Asia/Ho Chi Minh timezone.'
                )}
              </p>
            </div>
          </div>
          <div className='flex shrink-0 flex-wrap gap-3 sm:flex-col sm:items-end md:flex-row'>
            <Link
              to='/privacy-policy'
              className='group text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline'
            >
              {t('Privacy Policy')}
              <ArrowRight className='duration-control size-3.5 transition-transform group-hover:translate-x-0.5' />
            </Link>
            <Link
              to='/user-agreement'
              className='group text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline'
            >
              {t('User Agreement')}
              <ArrowRight className='duration-control size-3.5 transition-transform group-hover:translate-x-0.5' />
            </Link>
          </div>
        </AnimateInView>
      </div>
    </section>
  )
}
