import type { TFunction } from 'i18next'

import { CHART_SERIES_COLORS } from '@/features/dashboard/lib/chart-palette'
import type {
  DashboardRankChart,
  DashboardSeriesChart,
} from '@/features/dashboard/types'

import type { AcquisitionChannelStat, UserQueryFilter } from '../types'

/** Preset windows offered by every analytics panel in the operations console. */
export const OPS_RANGE_PRESETS = [
  { labelKey: '7 Days', days: 7 },
  { labelKey: '30 Days', days: 30 },
  { labelKey: '90 Days', days: 90 },
] as const

export const OPS_DEFAULT_RANGE_DAYS = 30

/**
 * Builds the inclusive unix-second window the analytics endpoints expect. The
 * start is snapped to local midnight because the backend rollups are stored at
 * local-day grain.
 */
export function buildOpsTimeRange(days: number) {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - (days - 1))
  start.setHours(0, 0, 0, 0)
  return {
    start_timestamp: Math.floor(start.getTime() / 1000),
    end_timestamp: Math.floor(end.getTime() / 1000),
  }
}

/** Formats a day-start unix timestamp as the short axis label `MM-DD`. */
export function formatDayLabel(day: number): string {
  const date = new Date(day * 1000)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(date.getDate()).padStart(2, '0')
  return `${month}-${dayOfMonth}`
}

/** Percentage change between two periods, or null when there is no baseline. */
export function periodDelta(current: number, previous: number): number | null {
  if (!previous) return null
  return ((current - previous) / previous) * 100
}

interface SeriesDefinition<T> {
  key: string
  label: string
  value: (row: T) => number
}

/**
 * Reshapes a day-indexed API series into the wide-row format the shared
 * dashboard chart components render.
 */
export function buildDaySeriesChart<T extends { day: number }>(
  rows: T[],
  series: SeriesDefinition<T>[],
  title: string,
  valueKind: 'quota' | 'count' = 'count'
): DashboardSeriesChart {
  return {
    rows: rows.map((row) => {
      const entry: Record<string, string | number> = {
        day: formatDayLabel(row.day),
      }
      series.forEach((definition) => {
        entry[definition.label] = definition.value(row)
      })
      return entry
    }),
    xKey: 'day',
    seriesKeys: series.map((definition) => definition.label),
    valueKind,
    title,
  }
}

/** Reshapes channel breakdowns into the shared horizontal rank chart. */
export function buildChannelRankChart(
  stats: AcquisitionChannelStat[],
  title: string,
  t: TFunction
): DashboardRankChart {
  return {
    rows: stats.slice(0, 10).map((stat, index) => ({
      name: stat.channel === 'unknown' ? t('Unknown') : stat.channel,
      value: stat.users,
      fill: CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length],
    })),
    valueKind: 'count',
    layout: 'vertical',
    title,
  }
}

/**
 * Predicates whose `false` value is a real filter rather than an unset toggle.
 * `has_paid: false` means "never paid", one of the most useful audiences, so it
 * has to survive compaction.
 */
const TRI_STATE_FILTER_KEYS = new Set(['has_paid', 'has_subscription'])

/** Removes empty values so a saved segment stores only meaningful predicates. */
export function compactFilter(filter: UserQueryFilter): UserQueryFilter {
  const compacted: UserQueryFilter = {}
  Object.entries(filter).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value) && value.length === 0) return
    if (value === false && !TRI_STATE_FILTER_KEYS.has(key)) return
    Object.assign(compacted, { [key]: value })
  })
  return compacted
}

/** True when the filter narrows the audience at all. */
export function hasActiveFilter(filter: UserQueryFilter): boolean {
  return Object.keys(compactFilter(filter)).length > 0
}
