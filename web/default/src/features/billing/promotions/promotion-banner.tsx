import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { getPromotion } from './api'

export function PromotionBanner(props: {
  position: 'console_top' | 'billing'
}) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['topup-promotion'],
    queryFn: () => getPromotion(),
    refetchInterval: 60000,
    staleTime: 30000,
  })
  const promotion = query.data
  const now = Date.now() / 1000
  if (
    !promotion?.enabled ||
    !promotion.banner_enabled ||
    promotion.starts_at > now ||
    (promotion.ends_at > 0 && promotion.ends_at <= now)
  ) {
    return null
  }
  const position = promotion.banner_position || 'console_top'
  if (position !== 'both' && position !== props.position) return null
  return (
    <Link
      to='/billing'
      className='bg-primary/10 text-primary block shrink-0 rounded-md px-4 py-2 text-center text-sm font-medium hover:underline'
    >
      {promotion.banner_text ||
        (promotion.max_discount === 0
          ? t('Top up from {{minimum}} VND and save {{percent}}%.', {
              minimum: promotion.min_amount.toLocaleString(),
              percent: promotion.percent_off,
            })
          : t(
              'Top up from {{minimum}} VND and save {{percent}}% (up to {{cap}} VND).',
              {
                minimum: promotion.min_amount.toLocaleString(),
                percent: promotion.percent_off,
                cap: promotion.max_discount.toLocaleString(),
              }
            ))}
    </Link>
  )
}
