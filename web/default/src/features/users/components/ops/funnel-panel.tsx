import { useTranslation } from 'react-i18next'

import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { formatNumber } from '@/lib/format'

import type { UserFunnelStage } from '../../types'

const STAGE_LABELS: Record<string, string> = {
  registered: 'Registered',
  activated: 'Made a first call',
  paid: 'Paid once',
  repeat_paid: 'Paid again',
}

export function FunnelPanel(props: {
  stages: UserFunnelStage[]
  loading?: boolean
}) {
  const { t } = useTranslation()
  const top = props.stages[0]?.count ?? 0

  return (
    <PanelWrapper
      title={t('Conversion funnel')}
      description={t('Cohort of users who registered in the selected window')}
      loading={props.loading}
      empty={!props.loading && top === 0}
      height='h-72'
    >
      <div className='space-y-3'>
        {props.stages.map((stage, index) => {
          const share = top > 0 ? (stage.count / top) * 100 : 0
          const previous = props.stages[index - 1]?.count
          const stepRate =
            previous && previous > 0 ? (stage.count / previous) * 100 : null
          return (
            <div key={stage.key} className='space-y-1.5'>
              <div className='flex items-baseline justify-between gap-2 text-xs'>
                <span className='font-medium'>
                  {t(STAGE_LABELS[stage.key] ?? stage.key)}
                </span>
                <span className='text-muted-foreground tabular-nums'>
                  {formatNumber(stage.count)}
                  {stepRate !== null && (
                    <span className='ml-2'>
                      {t('{{value}}% of previous step', {
                        value: Math.round(stepRate * 10) / 10,
                      })}
                    </span>
                  )}
                </span>
              </div>
              <div className='bg-muted h-2.5 w-full overflow-hidden rounded-full'>
                <div
                  className='bg-primary h-full rounded-full'
                  style={{ width: `${Math.max(share, share > 0 ? 2 : 0)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </PanelWrapper>
  )
}
