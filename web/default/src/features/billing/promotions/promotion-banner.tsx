import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { getPromotion } from './api'
import { eligiblePromotionTiers } from './tiers'

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
  const tiers = eligiblePromotionTiers(promotion, Date.now() / 1000)
  if (!promotion?.banner_enabled || tiers.length === 0) {
    return null
  }
  const first = tiers[0]
  const top = tiers.at(-1) ?? first
  let text = promotion.banner_text
  if (!text && tiers.length > 1) {
    text = t('Top up from {{minimum}} VND and save up to {{percent}}%.', {
      minimum: first.min_amount.toLocaleString(),
      percent: top.percent_off,
    })
  } else if (!text && first.max_discount === 0) {
    text = t('Top up from {{minimum}} VND and save {{percent}}%.', {
      minimum: first.min_amount.toLocaleString(),
      percent: first.percent_off,
    })
  } else if (!text) {
    text = t(
      'Top up from {{minimum}} VND and save {{percent}}% (up to {{cap}} VND).',
      {
        minimum: first.min_amount.toLocaleString(),
        percent: first.percent_off,
        cap: first.max_discount.toLocaleString(),
      }
    )
  }
  const position = promotion.banner_position || 'console_top'
  if (position !== 'both' && position !== props.position) return null
  return (
    <Link
      to='/billing'
      className='bg-primary/10 text-primary block shrink-0 rounded-md px-4 py-2 text-center text-sm font-medium hover:underline'
    >
      {text}
    </Link>
  )
}
