import { useQuery } from '@tanstack/react-query'
import { useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Users, Loader2 } from '@/components/icons'
import { IconBadge } from '@/components/ui/icon-badge'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Skeleton } from '@/components/ui/skeleton'
import { getUserQuotaDataByUsers } from '@/features/dashboard/api'
import {
  TIME_GRANULARITY_OPTIONS,
  TIME_RANGE_PRESETS,
} from '@/features/dashboard/constants'
import {
  getDefaultDays,
  saveGranularity,
  processUserChartData,
} from '@/features/dashboard/lib'
import type { UserChartsFilters } from '@/features/dashboard/types'
import { getRollingDateRange, type TimeGranularity } from '@/lib/time'

import {
  DashboardRankChartView,
  DashboardSeriesChartView,
  CHART_SERIES_COLORS,
} from '../ui/dashboard-charts'

const TOP_USER_LIMIT_OPTIONS = [5, 10, 20, 50]

interface UserChartsProps {
  filters: UserChartsFilters
  onFiltersChange: (filters: UserChartsFilters) => void
}

export function UserCharts(props: UserChartsProps) {
  const { t } = useTranslation()

  const timeGranularity = props.filters.timeGranularity
  const selectedRange = props.filters.selectedRange
  const topUserLimit = props.filters.topUserLimit
  const onFiltersChange = props.onFiltersChange

  const timeRange = useMemo(() => {
    const { start, end } = getRollingDateRange(selectedRange)
    return {
      start_timestamp: Math.floor(start.getTime() / 1000),
      end_timestamp: Math.floor(end.getTime() / 1000),
    }
  }, [selectedRange])

  const handleRangeChange = useCallback(
    (days: number) => {
      onFiltersChange({ ...props.filters, selectedRange: days })
    },
    [onFiltersChange, props.filters]
  )

  const handleGranularityChange = useCallback(
    (g: TimeGranularity) => {
      saveGranularity(g)
      onFiltersChange({
        ...props.filters,
        timeGranularity: g,
        selectedRange: getDefaultDays(g),
      })
    },
    [onFiltersChange, props.filters]
  )

  const handleTopUserLimitChange = useCallback(
    (limit: number) => {
      onFiltersChange({ ...props.filters, topUserLimit: limit })
    },
    [onFiltersChange, props.filters]
  )

  const { data: userData, isLoading } = useQuery({
    queryKey: ['dashboard', 'user-quota', timeRange],
    queryFn: () => getUserQuotaDataByUsers(timeRange),
    select: (res) => (res.success ? res.data : []),
    staleTime: 60_000,
  })

  const chartData = useMemo(
    () =>
      processUserChartData(
        isLoading ? [] : (userData ?? []),
        timeGranularity,
        t,
        topUserLimit
      ),
    [userData, isLoading, timeGranularity, t, topUserLimit]
  )

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <SegmentedControl
          size='sm'
          aria-label={t('Time range')}
          value={String(selectedRange)}
          onValueChange={(value) => handleRangeChange(Number(value))}
          options={TIME_RANGE_PRESETS.map((preset) => ({
            value: String(preset.days),
            label: t(preset.labelKey),
          }))}
        />
        <SegmentedControl
          size='sm'
          aria-label={t('Time granularity')}
          value={timeGranularity}
          onValueChange={(value) =>
            handleGranularityChange(value as TimeGranularity)
          }
          options={TIME_GRANULARITY_OPTIONS.map((opt) => ({
            value: opt.value,
            label: t(opt.labelKey),
          }))}
        />
        <div className='flex items-center gap-2'>
          <span className='text-muted-foreground text-xs font-medium whitespace-nowrap'>
            {t('Top Users')}
          </span>
          <SegmentedControl
            size='sm'
            aria-label={t('Top Users')}
            value={String(topUserLimit)}
            onValueChange={(value) => handleTopUserLimitChange(Number(value))}
            options={TOP_USER_LIMIT_OPTIONS.map((limit) => ({
              value: String(limit),
              label: t('Top {{count}}', { count: limit }),
            }))}
          />
        </div>

        {isLoading && (
          <Loader2 className='text-muted-foreground size-4 animate-spin' />
        )}
      </div>

      <div className='grid gap-3'>
        <div className='bg-card ring-border overflow-hidden rounded-2xl ring-1'>
          <div className='flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 border-b px-4 py-3 sm:px-5'>
            <IconBadge tone='info' size='sm'>
              <Users />
            </IconBadge>
            <div className='text-sm font-semibold'>
              {t('User Consumption Ranking')}
            </div>
            {chartData.rank.subtext && (
              <span className='text-muted-foreground text-xs tabular-nums'>
                {chartData.rank.subtext}
              </span>
            )}
          </div>
          <div className='h-[300px] p-2 sm:h-96 sm:p-3'>
            {isLoading ? (
              <Skeleton className='h-full w-full' />
            ) : (
              <DashboardRankChartView chart={chartData.rank} />
            )}
          </div>
        </div>

        <div className='bg-card ring-border overflow-hidden rounded-2xl ring-1'>
          <div className='flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 border-b px-4 py-3 sm:px-5'>
            <IconBadge tone='info' size='sm'>
              <Users />
            </IconBadge>
            <div className='text-sm font-semibold'>
              {t('User Consumption Trend')}
            </div>
          </div>
          <div className='h-[300px] p-2 sm:h-96 sm:p-3'>
            {isLoading ? (
              <Skeleton className='h-full w-full' />
            ) : (
              <DashboardSeriesChartView
                chart={chartData.trend}
                variant='area'
                colors={CHART_SERIES_COLORS}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
