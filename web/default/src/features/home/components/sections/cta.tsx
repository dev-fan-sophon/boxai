import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { ArrowRight } from '@/components/icons'
import { Button } from '@/components/ui/button'

import { BrandGlow, Eyebrow, MarketingSection } from '../marketing'

interface CTAProps {
  className?: string
  isAuthenticated?: boolean
}

export function CTA(props: CTAProps) {
  const { t } = useTranslation()

  return (
    <MarketingSection label={t('Start Building')} className='pt-0 sm:pt-0'>
      <AnimateInView
        animation='scale-in'
        className='border-border/60 bg-card shadow-raised relative isolate overflow-hidden rounded-3xl border px-6 py-14 text-center sm:px-10 sm:py-20'
      >
        <BrandGlow />
        <Eyebrow className='mb-4'>{t('Start Building')}</Eyebrow>
        <h2 className='mx-auto max-w-2xl text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl'>
          {t('Start with the API, the workspace, or the apps')}
        </h2>
        <p className='text-muted-foreground mx-auto mt-4 max-w-xl text-sm leading-relaxed text-pretty sm:text-base'>
          {t(
            'One unified API, a browser workspace, and desktop apps, all on you-box.com.'
          )}
        </p>
        <div className='mt-8 flex flex-wrap items-center justify-center gap-3'>
          <Button
            variant='cta'
            size='lg'
            className='group h-11 px-6'
            render={
              <Link to={props.isAuthenticated ? '/dashboard' : '/sign-up'} />
            }
          >
            {t('Get Started')}
            <ArrowRight className='duration-control size-4 transition-transform group-hover:translate-x-0.5' />
          </Button>
          <Button
            variant='outline'
            size='lg'
            className='bg-background/70 h-11 px-6'
            render={<Link to='/pricing' />}
          >
            {t('Model Hub')}
          </Button>
        </div>
      </AnimateInView>
    </MarketingSection>
  )
}
