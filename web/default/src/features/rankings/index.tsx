import { useNavigate, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-enter'
import { Skeleton } from '@/components/ui/skeleton'
import { BrandGlow } from '@/features/home/components/marketing'

import {
  MarketShareSection,
  ModelsSection,
  PulseSection,
  RankingsHero,
} from './components'
import { useRankings } from './hooks/use-rankings'
import type { RankingPeriod } from './types'

const VALID_PERIODS: ReadonlySet<RankingPeriod> = new Set([
  'today',
  'week',
  'month',
  'year',
])

export function Rankings() {
  const { t } = useTranslation()
  const search = useSearch({ from: '/_public/rankings/' })
  const navigate = useNavigate()

  const period: RankingPeriod = VALID_PERIODS.has(
    search.period as RankingPeriod
  )
    ? (search.period as RankingPeriod)
    : 'week'

  const rankingsQuery = useRankings(period)
  const snapshot = rankingsQuery.data?.data

  const handlePeriodChange = (next: RankingPeriod) => {
    navigate({
      to: '/rankings',
      search: (prev) => ({ ...prev, period: next }),
    })
  }

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <div
          aria-hidden='true'
          className='pointer-events-none absolute inset-x-0 top-0 h-[28rem] overflow-hidden'
        >
          <BrandGlow className='opacity-70' />
        </div>
        <PageTransition className='relative mx-auto w-full max-w-6xl space-y-6 px-4 pt-24 pb-12 sm:space-y-8 sm:px-6 sm:pt-28 sm:pb-16'>
          <RankingsHero period={period} onPeriodChange={handlePeriodChange} />

          {rankingsQuery.isLoading && <RankingsLoading />}
          {!rankingsQuery.isLoading && !snapshot && (
            <RankingsError
              message={
                rankingsQuery.error instanceof Error
                  ? rankingsQuery.error.message
                  : t('Unable to load rankings data')
              }
            />
          )}
          {!rankingsQuery.isLoading && snapshot && (
            <>
              <ModelsSection
                history={snapshot.models_history}
                rows={snapshot.models}
                period={period}
              />

              <MarketShareSection
                history={snapshot.vendor_share_history}
                rows={snapshot.vendors}
                period={period}
              />

              <PulseSection
                movers={snapshot.top_movers}
                droppers={snapshot.top_droppers}
              />
            </>
          )}
        </PageTransition>
      </div>
    </PublicLayout>
  )
}

function RankingsLoading() {
  return (
    <div className='space-y-6'>
      <Skeleton className='h-[420px] w-full rounded-2xl' />
      <Skeleton className='h-[360px] w-full rounded-2xl' />
      <Skeleton className='h-[180px] w-full rounded-2xl' />
    </div>
  )
}

function RankingsError(props: { message: string }) {
  const { t } = useTranslation()
  return (
    <ErrorState
      className='bg-card min-h-[240px] border border-dashed'
      title={t('Unable to load rankings')}
      description={props.message}
    />
  )
}
