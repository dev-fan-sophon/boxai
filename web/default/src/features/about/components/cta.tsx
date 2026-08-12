import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

export function AboutCta() {
  const { t } = useTranslation()
  const isAuthenticated = !!useAuthStore((s) => s.auth.user)

  return (
    <section className='relative z-10 overflow-hidden px-6 py-20 md:py-28'>
      <div
        aria-hidden
        className='absolute inset-0 -z-10 opacity-25 dark:opacity-[0.12]'
        style={{
          background: [
            'radial-gradient(ellipse 55% 55% at 30% 50%, oklch(0.7 0.15 250 / 70%) 0%, transparent 70%)',
            'radial-gradient(ellipse 45% 45% at 75% 40%, oklch(0.65 0.12 280 / 55%) 0%, transparent 70%)',
          ].join(', '),
        }}
      />

      <AnimateInView
        className='mx-auto max-w-2xl text-center'
        animation='scale-in'
      >
        <p className='text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase'>
          {t('Start Building')}
        </p>
        <h2 className='text-2xl leading-tight font-bold tracking-tight md:text-4xl'>
          {t('Start with the API, the workspace, or the apps')}
        </h2>
        <p className='text-muted-foreground mx-auto mt-4 max-w-lg text-sm leading-relaxed text-pretty md:text-base'>
          {t(
            'Create an account, pick a model in Model Hub, and send your first request through https://you-box.com/v1.'
          )}
        </p>
        <div className='mt-8 flex flex-wrap items-center justify-center gap-3'>
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
                params={{ _splat: 'start/getting-started' }}
              />
            }
          >
            {t('Getting Started')}
          </Button>
        </div>
      </AnimateInView>
    </section>
  )
}
