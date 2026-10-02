import { useTranslation } from 'react-i18next'

import { SegmentedControl } from '@/components/ui/segmented-control'
import { Eyebrow } from '@/features/home/components/marketing'

import type { RankingPeriod } from '../types'

const PERIODS: { id: RankingPeriod; labelKey: string }[] = [
  { id: 'today', labelKey: '1 day' },
  { id: 'week', labelKey: '1 week' },
  { id: 'month', labelKey: '1 month' },
  { id: 'year', labelKey: '1 year' },
]

type RankingsHeroProps = {
  period: RankingPeriod
  onPeriodChange: (period: RankingPeriod) => void
}

/**
 * Hero strip for the rankings page. Intentionally minimal — title +
 * subtitle + period tabs only.
 */
export function RankingsHero(props: RankingsHeroProps) {
  const { t } = useTranslation()

  return (
    <section className='flex flex-wrap items-end justify-between gap-x-8 gap-y-5'>
      <div className='max-w-2xl min-w-0'>
        <Eyebrow className='mb-4'>{t('Live Insights')}</Eyebrow>
        <h1 className='text-foreground text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl'>
          {t('Popular Model Rankings')}
        </h1>
        <p className='text-muted-foreground mt-3 text-sm leading-relaxed text-pretty sm:text-base'>
          {t(
            'Track AI model usage trends to choose the best model — live platform data, no mock charts.'
          )}
        </p>
      </div>

      <SegmentedControl
        aria-label={t('Period')}
        value={props.period}
        onValueChange={props.onPeriodChange}
        options={PERIODS.map((p) => ({ value: p.id, label: t(p.labelKey) }))}
      />
    </section>
  )
}
