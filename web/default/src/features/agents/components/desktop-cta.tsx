import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { Button } from '@/components/ui/button'
import { DownloadActions } from '@/features/downloads/download-actions'
import type { DesktopDownload } from '@/features/downloads/types'
import {
  BrandGlow,
  Eyebrow,
  MarketingSection,
} from '@/features/home/components/marketing'
import { useAuthStore } from '@/stores/auth-store'

export function DesktopCta(props: {
  primary?: DesktopDownload
  loading: boolean
  failed: boolean
  fallbackUrl: string
}) {
  const { t } = useTranslation()
  const { auth } = useAuthStore()
  const isAuthenticated = !!auth.user

  return (
    <MarketingSection labelledBy='desktop-cta'>
      <AnimateInView
        animation='scale-in'
        className='border-border/60 bg-card shadow-raised relative isolate flex flex-col items-center overflow-hidden rounded-3xl border px-6 py-14 text-center sm:px-10 sm:py-20'
      >
        <BrandGlow />
        <Eyebrow className='mb-4'>{t('Get started')}</Eyebrow>
        <h2
          id='desktop-cta'
          className='max-w-2xl text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl'
        >
          {t('Put an AI coworker on your desktop')}
        </h2>
        <p className='text-muted-foreground mt-4 max-w-xl text-sm leading-relaxed text-pretty sm:text-base'>
          {t(
            'Model access comes from the BoxAI account you already have, so nothing new to set up and nothing extra to pay for.'
          )}
        </p>

        <div className='mt-8 flex flex-wrap items-center justify-center gap-3'>
          <DownloadActions
            downloads={[]}
            primary={props.primary}
            loading={props.loading}
            failed={props.failed}
            fallbackUrl={props.fallbackUrl}
            productName={t('BoxAI Desktop')}
            className='justify-center'
          />
          {!isAuthenticated && (
            <Button
              variant='outline'
              size='lg'
              className='bg-background/70'
              render={<Link to='/sign-up' />}
            >
              {t('Create a BoxAI account')}
            </Button>
          )}
        </div>
      </AnimateInView>
    </MarketingSection>
  )
}
