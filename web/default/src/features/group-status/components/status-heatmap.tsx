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

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import {
  formatBucketRange,
  seriesCellTone,
  type StatusTone,
} from '../lib/status'
import type { GroupStatusSeriesPoint } from '../types'

const CELL_CLASS: Record<StatusTone | 'empty', string> = {
  healthy: 'bg-emerald-500/85 hover:bg-emerald-400',
  slow: 'bg-amber-500/85 hover:bg-amber-400',
  down: 'bg-rose-500/85 hover:bg-rose-400',
  observing: 'bg-muted',
  empty: 'bg-muted/60 hover:bg-muted',
}

type StatusHeatmapProps = {
  series: GroupStatusSeriesPoint[]
  bucketSeconds: number
}

export function StatusHeatmap(props: StatusHeatmapProps) {
  const { i18n, t } = useTranslation()
  const locale = i18n.resolvedLanguage || i18n.language

  if (!props.series?.length) {
    return (
      <p className='text-muted-foreground text-xs'>{t('No series data')}</p>
    )
  }

  return (
    <TooltipProvider delay={200}>
      <div className='space-y-1.5'>
        <div className='flex flex-wrap gap-0.5'>
          {props.series.map((point) => {
            const tone = seriesCellTone(point.success_rate, point.request_count)
            const range = formatBucketRange(
              point.ts,
              props.bucketSeconds,
              locale
            )
            let tip: string
            if (tone === 'empty') {
              tip = t('{{range}}, no request samples', { range })
            } else {
              tip = t('{{range}}, success rate {{rate}}%', {
                range,
                rate:
                  point.success_rate != null
                    ? point.success_rate.toFixed(1)
                    : '—',
              })
            }

            return (
              <Tooltip key={point.ts}>
                <TooltipTrigger
                  render={
                    <button
                      type='button'
                      className={cn(
                        'h-3 w-2 rounded-[2px] transition-colors sm:h-3.5 sm:w-2.5',
                        CELL_CLASS[tone]
                      )}
                      aria-label={tip}
                    />
                  }
                />
                <TooltipContent side='top' className='text-xs'>
                  {tip}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        <div className='text-muted-foreground flex flex-wrap gap-3 text-[10px]'>
          <LegendDot className={CELL_CLASS.healthy} label={t('Smooth')} />
          <LegendDot className={CELL_CLASS.slow} label={t('Slow')} />
          <LegendDot className={CELL_CLASS.down} label={t('Fault')} />
          <LegendDot className={CELL_CLASS.empty} label={t('No samples')} />
        </div>
      </div>
    </TooltipProvider>
  )
}

function LegendDot(props: { className: string; label: string }) {
  return (
    <span className='inline-flex items-center gap-1'>
      <span className={cn('size-2 rounded-[2px]', props.className)} />
      {props.label}
    </span>
  )
}
