import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'

import { useOrderExpired } from './use-order-expired'

export function OrderExpiry(props: { expiresAt?: number }) {
  const { t, i18n } = useTranslation()
  const expired = useOrderExpired(props.expiresAt)
  if (!props.expiresAt) return null
  return (
    <p className='text-muted-foreground text-sm' role='status'>
      {expired
        ? t('Payment expired. Do not transfer funds.')
        : t('Pay before {{time}}', {
            time: new Date(props.expiresAt * 1000).toLocaleString(
              toIntlLocale(i18n.language)
            ),
          })}
    </p>
  )
}
