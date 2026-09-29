import { useTranslation } from 'react-i18next'

import { formatNumber } from '@/lib/format'

import { formatCreemPrice } from '../lib/format'
import type { CreemProduct } from '../types'

/**
 * Creem product review shown inside the top-up dialog before checkout.
 */
export function CreemPurchaseSummary(props: { product: CreemProduct }) {
  const { t } = useTranslation()

  return (
    <div className='space-y-3 sm:space-y-4'>
      <div className='flex items-center justify-between'>
        <span className='text-muted-foreground'>{t('Product')}</span>
        <span className='font-medium'>{props.product.name}</span>
      </div>
      <div className='flex items-center justify-between'>
        <span className='text-muted-foreground'>{t('Price')}</span>
        <span className='text-primary font-medium'>
          {formatCreemPrice(props.product.price, props.product.currency)}
        </span>
      </div>
      <div className='flex items-center justify-between'>
        <span className='text-muted-foreground'>{t('Quota')}</span>
        <span className='font-medium'>{formatNumber(props.product.quota)}</span>
      </div>
    </div>
  )
}
