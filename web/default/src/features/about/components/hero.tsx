import { Link } from '@tanstack/react-router'
import { ArrowRight, Globe2, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useSystemConfig } from '@/hooks/use-system-config'
import { useAuthStore } from '@/stores/auth-store'

export function AboutHero() {
  const { t } = useTranslation()
  const { systemName } = useSystemConfig()
  const isAuthenticated = !!useAuthStore((s) => s.auth.user)
  const brand = systemName || 'BoxAI'

  return (
    <section
      aria-labelledby='about-hero-title'
      className='relative z-10 overflow-hidden px-6 pt-24 pb-16 md:pt-32 md:pb-20'
    >
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 -z-10 opacity-40 dark:opacity-[0.18]'
        style={{
          background: [
            'radial-gradient(ellipse 70% 55% at 15% 20%, oklch(0.78 0.14 250 / 70%) 0%, transparent 70%)',
            'radial-gradient(ellipse 55% 45% at 85% 15%, oklch(0.72 0.12 280 / 55%) 0%, transparent 72%)',
            'radial-gradient(ellipse 45% 40% at 55% 85%, oklch(0.80 0.08 220 / 40%) 0%, transparent 70%)',
          ].join(', '),
        }}
      />

      <div className='mx-auto max-w-6xl'>
        <div
          className='landing-animate-fade-up mb-5 inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/5 px-3 py-1.5 text-[11px] font-medium text-blue-600 opacity-0 shadow-xs dark:border-blue-400/20 dark:bg-blue-400/5 dark:text-blue-400'
          style={{ animationDelay: '0ms' }}
        >
          <Sparkles className='size-3.5' aria-hidden='true' />
          <span>{t('About BoxAI')}</span>
        </div>

        <h1
          id='about-hero-title'
          className='landing-animate-fade-up max-w-3xl text-[clamp(2.25rem,4.5vw,3.4rem)] leading-[1.12] font-bold tracking-tight text-balance opacity-0'
          style={{ animationDelay: '60ms' }}
        >
          <span className='bg-gradient-to-r from-blue-500 via-blue-600 to-violet-500 bg-clip-text text-transparent'>
            {brand}
          </span>{' '}
          {t('Every model, one account')}
        </h1>

        <p
          className='landing-animate-fade-up text-muted-foreground mt-5 max-w-2xl text-base leading-relaxed text-pretty opacity-0 md:text-lg'
          style={{ animationDelay: '120ms' }}
        >
          {t(
            'BoxAI (you-box.com) is the official unified AI API gateway. One base URL, one set of keys, and one billing account for OpenAI-compatible, Claude, Gemini, and other providers — plus a browser workspace and desktop apps on the same account.'
          )}
        </p>

        <div
          className='landing-animate-fade-up mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm opacity-0'
          style={{ animationDelay: '160ms' }}
        >
          <span className='text-muted-foreground inline-flex items-center gap-1.5'>
            <Globe2 className='size-3.5 shrink-0' aria-hidden='true' />
            {t('Primary market: Vietnam · Secondary: other overseas markets')}
          </span>
          <a
            href='https://you-box.com'
            className='text-primary font-medium hover:underline'
            target='_blank'
            rel='noopener noreferrer'
          >
            you-box.com
          </a>
        </div>

        <div
          className='landing-animate-fade-up mt-8 flex flex-wrap items-center gap-3 opacity-0'
          style={{ animationDelay: '200ms' }}
        >
          <Button
            variant='cta'
            className='group'
            render={
              <Link to={isAuthenticated ? '/dashboard' : '/sign-up'} />
            }
          >
            {t('Get Started')}
            <ArrowRight className='duration-control ml-1 size-3.5 transition-transform group-hover:translate-x-0.5' />
          </Button>
          <Button
            variant='outline'
            className='border-border/50 hover:border-border hover:bg-muted/50'
            render={
              <Link
                to='/docs/$'
                params={{ _splat: 'start/what-is-boxai' }}
              />
            }
          >
            {t('What is BoxAI')}
          </Button>
          <Button
            variant='ghost'
            render={<Link to='/pricing' />}
          >
            {t('Model Hub')}
          </Button>
        </div>
      </div>
    </section>
  )
}
