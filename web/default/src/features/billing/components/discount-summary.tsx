import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'

import type { TopUpDiscountSnapshot } from '../types'

export function DiscountSummary(props: {
  snapshot: TopUpDiscountSnapshot
  paid: number
}) {
  const { t, i18n } = useTranslation()
  const snapshot = props.snapshot
  const money = new Intl.NumberFormat(toIntlLocale(i18n.language), {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  })
  return (
    <dl
      className='bg-muted/40 space-y-2 rounded-lg p-3 text-sm'
      aria-label={t('Discount details')}
    >
      {snapshot.face_amount != null && (
        <div className='flex justify-between gap-3'>
          <dt>{t('Face amount')}</dt>
          <dd>{money.format(snapshot.face_amount)}</dd>
        </div>
      )}
      <div className='flex justify-between gap-3'>
        <dt>{t('Activity discount')}</dt>
        <dd>−{money.format(snapshot.activity_discount || 0)}</dd>
      </div>
      <div className='flex justify-between gap-3'>
        <dt>
          {t('Coupon discount')}{' '}
          {snapshot.coupon_code && <code>{snapshot.coupon_code}</code>}
        </dt>
        <dd>−{money.format(snapshot.coupon_discount || 0)}</dd>
      </div>
      <div className='flex justify-between gap-3 border-t pt-2 font-semibold'>
        <dt>{t('You Pay')}</dt>
        <dd>{money.format(props.paid)}</dd>
      </div>
      {snapshot.credit_usd != null && (
        <div className='flex justify-between gap-3'>
          <dt>{t('Balance credited (USD)')}</dt>
          <dd>
            {new Intl.NumberFormat(toIntlLocale(i18n.language), {
              style: 'currency',
              currency: 'USD',
            }).format(snapshot.credit_usd)}
          </dd>
        </div>
      )}
    </dl>
  )
}
