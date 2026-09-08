import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useIsAdmin } from '@/hooks/use-admin'

import { getTopUpReviews } from '../api'

export function PendingReviewReminder() {
  const { t } = useTranslation()
  const admin = useIsAdmin()
  const query = useQuery({
    queryKey: ['topup-pending-reviews'],
    enabled: admin,
    queryFn: () =>
      getTopUpReviews({
        status: 'submitted',
        keyword: '',
        page: 1,
        page_size: 1,
      }),
    refetchInterval: 30000,
  })
  const count = query.data?.data?.total || 0
  if (!admin || !count) return null
  return (
    <Link
      to='/pricing-center/$tab'
      params={{ tab: 'topup-reviews' }}
      className='bg-warning/10 text-foreground block shrink-0 px-4 py-2 text-center text-sm hover:underline'
    >
      {t('Payment proofs awaiting review: {{count}}', { count })}
    </Link>
  )
}
