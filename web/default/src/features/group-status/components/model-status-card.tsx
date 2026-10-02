import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'

import { normalizeStatus, statusLabelKey } from '../lib/status'
import type { GroupStatusModel } from '../types'
import { StatusHeatmap } from './status-heatmap'

const BADGE_VARIANT = {
  healthy: 'success',
  slow: 'warning',
  down: 'destructive',
  observing: 'secondary',
} as const

type ModelStatusCardProps = {
  model: GroupStatusModel
}

export function ModelStatusCard(props: ModelStatusCardProps) {
  const { t } = useTranslation()
  const tone = normalizeStatus(props.model.status)
  const rate =
    props.model.success_rate != null &&
    Number.isFinite(props.model.success_rate)
      ? Math.round(props.model.success_rate)
      : null

  return (
    <div className='bg-card ring-border rounded-2xl p-4 ring-1'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <h4
            className='truncate font-mono text-sm font-semibold'
            title={props.model.model}
          >
            {props.model.model}
          </h4>
          <p className='text-muted-foreground mt-0.5 text-xs'>
            {t('Last {{hours}} hours', {
              hours: props.model.series_window || 24,
            })}
          </p>
        </div>
        <Badge variant={BADGE_VARIANT[tone]} className='shrink-0'>
          {t(statusLabelKey(tone))}
        </Badge>
      </div>

      <div className='mt-3 flex items-baseline gap-1.5'>
        <span className='text-muted-foreground text-xs'>
          {t('Success rate')}
        </span>
        <span className='text-xl font-semibold tabular-nums'>
          {rate == null ? '—' : rate}
        </span>
        <span className='text-muted-foreground text-sm'>%</span>
      </div>

      <div className='mt-3'>
        <StatusHeatmap
          series={props.model.series || []}
          bucketSeconds={props.model.bucket_seconds || 1800}
        />
      </div>
    </div>
  )
}
