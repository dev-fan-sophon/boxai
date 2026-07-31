import { useTranslation } from 'react-i18next'

import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { cn } from '@/lib/utils'

import { formatDayLabel } from '../../lib/ops'
import type { UserRetentionCohort } from '../../types'

/** Columns rendered in the heatmap; wider matrices stay readable this way. */
const VISIBLE_OFFSETS = 8
/** Newest cohorts first, capped so the panel does not grow without bound. */
const VISIBLE_COHORTS = 10

function cellTone(rate: number): string {
  if (rate >= 0.6) return 'bg-primary text-primary-foreground'
  if (rate >= 0.4) return 'bg-primary/70 text-primary-foreground'
  if (rate >= 0.2) return 'bg-primary/45 text-foreground'
  if (rate > 0) return 'bg-primary/20 text-foreground'
  return 'bg-muted text-muted-foreground'
}

export function RetentionPanel(props: {
  cohorts: UserRetentionCohort[]
  loading?: boolean
}) {
  const { t } = useTranslation()
  const cohorts = props.cohorts.slice(-VISIBLE_COHORTS).reverse()
  const offsets = Array.from({ length: VISIBLE_OFFSETS }, (_, index) => index)

  return (
    <PanelWrapper
      title={t('Retention by signup cohort')}
      description={t('Share of each day cohort that was active N days later')}
      loading={props.loading}
      empty={!props.loading && cohorts.length === 0}
      height='h-72'
      contentClassName='overflow-x-auto'
    >
      <table className='w-full text-xs'>
        <thead>
          <tr className='text-muted-foreground'>
            <th className='px-1 pb-2 text-left font-medium'>{t('Cohort')}</th>
            <th className='px-1 pb-2 text-right font-medium'>{t('Users')}</th>
            {offsets.map((offset) => (
              <th key={offset} className='px-1 pb-2 text-center font-medium'>
                {t('D{{offset}}', { offset })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((cohort) => (
            <tr key={cohort.cohort}>
              <td className='px-1 py-1 whitespace-nowrap'>
                {formatDayLabel(cohort.cohort)}
              </td>
              <td className='px-1 py-1 text-right tabular-nums'>
                {cohort.size}
              </td>
              {offsets.map((offset) => {
                const retained = cohort.retained[offset] ?? 0
                const rate = cohort.size > 0 ? retained / cohort.size : 0
                return (
                  <td key={offset} className='px-0.5 py-1'>
                    <div
                      className={cn(
                        'rounded-md py-1 text-center tabular-nums',
                        cellTone(rate)
                      )}
                      title={t('{{retained}} of {{size}} users', {
                        retained,
                        size: cohort.size,
                      })}
                    >
                      {rate > 0 ? `${Math.round(rate * 100)}%` : '-'}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </PanelWrapper>
  )
}
