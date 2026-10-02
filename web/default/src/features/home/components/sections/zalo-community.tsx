import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import {
  ZaloCommunityButton,
  ZaloCommunityQr,
} from '@/components/zalo-community'

import { Eyebrow, MarketingSection } from '../marketing'

export function ZaloCommunity() {
  const { t } = useTranslation()

  return (
    <MarketingSection labelledBy='zalo-community-title' className='sm:py-20'>
      <AnimateInView className='border-border/60 bg-card shadow-raised relative overflow-hidden rounded-3xl border p-6 sm:p-10'>
        <div
          aria-hidden='true'
          className='bg-brand-glow pointer-events-none absolute -top-32 -left-16 size-80 rounded-full opacity-70 blur-3xl'
        />
        <div className='relative grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:gap-14'>
          <div className='min-w-0 text-center md:text-left'>
            <Eyebrow className='mb-4'>{t('Zalo Community')}</Eyebrow>
            <h2
              id='zalo-community-title'
              className='text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl'
            >
              {t('Join the BoxAI community on Zalo')}
            </h2>
            <p className='text-muted-foreground mx-auto mt-4 max-w-xl text-sm leading-relaxed text-pretty sm:text-base md:mx-0'>
              {t(
                'Get product updates, support, and connect with BoxAI users in Vietnam.'
              )}
            </p>
            <ZaloCommunityButton className='mt-6' />
          </div>

          <ZaloCommunityQr imageClassName='size-44 sm:size-52' />
        </div>
      </AnimateInView>
    </MarketingSection>
  )
}
