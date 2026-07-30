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
import { BarChart3, Trophy } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart'
import { CHART_SERIES_COLORS } from '@/features/dashboard/lib/chart-palette'

import { createTokenAxisFormatter, formatTokens } from '../lib/format'
import type { ModelHistorySeries, ModelRanking, RankingPeriod } from '../types'
import { ModelLeaderboard } from './model-leaderboard'

const PERIOD_DESCRIPTIONS: Record<RankingPeriod, string> = {
  today: 'Hourly token usage by model across the last 24 hours',
  week: 'Daily token usage by model across the past week',
  month: 'Daily token usage by model across the past month',
  year: 'Weekly token usage by model across the past year',
}

const TOOLTIP_MAX_ROWS = 10

type ModelsSectionProps = {
  history: ModelHistorySeries
  rows: ModelRanking[]
  period: RankingPeriod
}

/** Shared tooltip: sorted model rows, capped with an aggregated overflow row. */
function ModelsHistoryTooltip(props: Partial<TooltipContentProps>) {
  const { t } = useTranslation()

  if (!props.active || !props.payload?.length) return null

  const entries = props.payload
    .map((item) => ({
      name: String(item.name ?? ''),
      color: item.color,
      value: Number(item.value) || 0,
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)

  if (entries.length === 0) return null

  const total = entries.reduce((sum, item) => sum + item.value, 0)
  const visible = entries.slice(0, TOOLTIP_MAX_ROWS)
  const overflow = entries.slice(TOOLTIP_MAX_ROWS)
  const overflowTotal = overflow.reduce((sum, item) => sum + item.value, 0)

  return (
    <div className='border-border/50 bg-background grid min-w-40 items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl'>
      {props.label != null && (
        <div className='font-medium'>{String(props.label)}</div>
      )}
      <div className='grid gap-1'>
        <div className='flex items-center justify-between gap-4 font-medium'>
          <span className='text-muted-foreground'>{t('Total:')}</span>
          <span className='text-foreground font-mono tabular-nums'>
            {formatTokens(total)}
          </span>
        </div>
        {visible.map((item) => (
          <div
            key={item.name}
            className='flex items-center justify-between gap-4'
          >
            <span className='flex min-w-0 items-center gap-1.5'>
              <span
                aria-hidden
                className='size-2.5 shrink-0 rounded-[2px]'
                style={{ backgroundColor: item.color }}
              />
              <span className='text-muted-foreground truncate'>
                {item.name}
              </span>
            </span>
            <span className='text-foreground font-mono tabular-nums'>
              {formatTokens(item.value)}
            </span>
          </div>
        ))}
        {overflow.length > 0 && (
          <div className='flex items-center justify-between gap-4'>
            <span className='text-muted-foreground'>
              {t('+{{count}} more', { count: overflow.length })}
            </span>
            <span className='text-foreground font-mono tabular-nums'>
              {formatTokens(overflowTotal)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Combined "Top Models" card: a stacked bar chart showing token usage by
 * model over time, paired below with a two-column LLM Leaderboard. The
 * chart anchors the eye while the leaderboard provides the detailed key.
 */
export function ModelsSection(props: ModelsSectionProps) {
  const { t } = useTranslation()

  const totalTokens = useMemo(
    () => props.rows.reduce((s, r) => s + r.total_tokens, 0),
    [props.rows]
  )

  // Series are ordered by total tokens desc so the largest model sits at the
  // bottom of every stack; rows stay in chronological bucket order.
  const chart = useMemo(() => {
    const models = props.history.models.map((model) => model.name)
    const rowsByTs = new Map<string, Record<string, number | string>>()

    // Seed from the server axis first so a bucket with no traffic keeps its
    // slot; otherwise a quiet day collapses and its neighbours read as
    // consecutive on the x axis.
    for (const bucket of props.history.axis ?? []) {
      rowsByTs.set(bucket.ts, { label: bucket.label })
    }

    for (const point of [...props.history.points].sort((a, b) =>
      a.ts.localeCompare(b.ts)
    )) {
      let row = rowsByTs.get(point.ts)
      if (!row) {
        row = { label: point.label }
        rowsByTs.set(point.ts, row)
      }
      row[point.model] = (Number(row[point.model]) || 0) + point.tokens
    }

    const config: ChartConfig = {}
    models.forEach((model, index) => {
      config[model] = {
        label: model,
        color: CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length],
      }
    })

    const rows = [...rowsByTs.values()]
    const peak = rows.reduce((max, row) => {
      const stacked = models.reduce(
        (sum, name) => sum + (Number(row[name]) || 0),
        0
      )
      return Math.max(max, stacked)
    }, 0)

    return { rows, models, config, peak }
  }, [props.history])

  const formatAxisTokens = useMemo(
    () => createTokenAxisFormatter(chart.peak),
    [chart.peak]
  )

  const hasChartData = chart.rows.length > 0 && chart.models.length > 0

  return (
    <section className='bg-card overflow-hidden rounded-lg border'>
      {/* Chart block ----------------------------------------------------- */}
      <header className='flex items-start justify-between gap-4 px-5 py-4'>
        <div className='min-w-0 flex-1'>
          <h2 className='text-foreground inline-flex items-center gap-2 text-base font-semibold'>
            <BarChart3 className='text-primary size-4' />
            {t('Top Models')}
          </h2>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t(PERIOD_DESCRIPTIONS[props.period])}
          </p>
        </div>
        <div className='shrink-0 text-right'>
          <div className='text-foreground font-mono text-2xl font-semibold tabular-nums'>
            {formatTokens(totalTokens)}
          </div>
          <div className='text-muted-foreground text-[10px] font-medium tracking-widest uppercase'>
            {t('tokens')}
          </div>
        </div>
      </header>

      <div className='px-5 pb-5'>
        <div className='ring-border overflow-hidden rounded-xl p-3 ring-1'>
          {hasChartData ? (
            <ChartContainer
              config={chart.config}
              className='aspect-auto h-60 w-full sm:h-72'
            >
              <BarChart
                data={chart.rows}
                margin={{ left: 4, right: 8, top: 8 }}
              >
                <CartesianGrid vertical={false} strokeDasharray='3 3' />
                <XAxis
                  dataKey='label'
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  tickMargin={8}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(value) =>
                    formatAxisTokens(Number(value) || 0)
                  }
                />
                <ChartTooltip
                  cursor={{ fillOpacity: 0.12 }}
                  content={<ModelsHistoryTooltip />}
                />
                {chart.models.map((model, index) => (
                  <Bar
                    key={model}
                    dataKey={model}
                    name={model}
                    stackId='tokens'
                    fill={
                      CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]
                    }
                    isAnimationActive
                  />
                ))}
              </BarChart>
            </ChartContainer>
          ) : (
            <div className='text-muted-foreground flex h-60 items-center justify-center text-xs sm:h-72'>
              {t('No history data available')}
            </div>
          )}
        </div>
      </div>

      {/* Leaderboard block ----------------------------------------------- */}
      <div className='border-t'>
        <header className='px-5 pt-4 pb-2'>
          <h3 className='text-foreground inline-flex items-center gap-2 text-sm font-semibold'>
            <Trophy className='size-3.5 text-amber-500' />
            {t('LLM Leaderboard')}
          </h3>
          <p className='text-muted-foreground mt-0.5 text-xs'>
            {t('Compare the most popular models on the platform')}
          </p>
        </header>
        {props.rows.length === 0 ? (
          <div className='text-muted-foreground px-5 py-8 text-center text-sm'>
            {t('No models match the selected filters')}
          </div>
        ) : (
          <div className='px-5 pt-1 pb-4'>
            <ModelLeaderboard rows={props.rows} />
          </div>
        )}
      </div>
    </section>
  )
}
