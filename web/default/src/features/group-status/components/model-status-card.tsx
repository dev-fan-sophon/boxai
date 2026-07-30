/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import { normalizeStatus, statusLabelKey } from '../lib/status'
import type { GroupStatusModel } from '../types'
import { StatusHeatmap } from './status-heatmap'

const BADGE_CLASS: Record<string, string> = {
  healthy:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  slow: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  down: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  observing: 'border-border bg-muted text-muted-foreground',
}

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
    <div className='bg-card rounded-xl border p-3.5 sm:p-4'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0'>
          <h4 className='truncate font-mono text-sm font-semibold'>
            {props.model.model}
          </h4>
          <p className='text-muted-foreground mt-0.5 text-xs'>
            {t('Last {{hours}} hours', {
              hours: props.model.series_window || 24,
            })}
          </p>
        </div>
        <Badge
          variant='outline'
          className={cn('shrink-0 font-medium', BADGE_CLASS[tone])}
        >
          {t(statusLabelKey(tone))}
        </Badge>
      </div>

      <div className='mt-3 flex items-baseline gap-1.5'>
        <span className='text-muted-foreground text-xs'>
          {t('Success rate')}
        </span>
        <span className='font-mono text-xl font-semibold tabular-nums'>
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
