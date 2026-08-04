import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import {
  ZaloCommunityButton,
  ZaloCommunityQr,
} from '@/components/zalo-community'

export function ZaloCommunity() {
  const { t } = useTranslation()

  return (
    <section
      aria-labelledby='zalo-community-title'
      className='border-border/40 bg-muted/20 relative z-10 border-y px-6 py-20 md:py-24'
    >
      <AnimateInView className='mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-[minmax(0,1fr)_auto] md:gap-16'>
        <div className='text-center md:text-left'>
          <p className='text-primary mb-3 text-xs font-medium tracking-widest uppercase'>
            {t('Zalo Community')}
          </p>
          <h2
            id='zalo-community-title'
            className='text-2xl font-bold tracking-tight text-balance md:text-3xl'
          >
            {t('Join the BoxAI community on Zalo')}
          </h2>
          <p className='text-muted-foreground mx-auto mt-4 max-w-xl text-sm leading-relaxed text-pretty md:mx-0 md:text-base'>
            {t(
              'Get product updates, support, and connect with BoxAI users in Vietnam.'
            )}
          </p>
          <ZaloCommunityButton className='mt-6' />
        </div>

        <ZaloCommunityQr imageClassName='size-48 sm:size-56' />
      </AnimateInView>
    </section>
  )
}
