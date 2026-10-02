import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PieChart as PieChartIcon } from '@/components/icons'
import { IconBadge } from '@/components/ui/icon-badge'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  DEFAULT_TIME_GRANULARITY,
  MODEL_ANALYTICS_CHART_OPTIONS,
} from '@/features/dashboard/constants'
import { processChartData } from '@/features/dashboard/lib'
import type {
  ModelAnalyticsChartTab,
  QuotaDataItem,
} from '@/features/dashboard/types'
import type { TimeGranularity } from '@/lib/time'

import {
  DashboardPieChartView,
  DashboardRankChartView,
  DashboardSeriesChartView,
} from '../ui/dashboard-charts'

interface ModelChartsProps {
  data: QuotaDataItem[]
  loading?: boolean
  timeGranularity?: TimeGranularity
  defaultChartTab?: ModelAnalyticsChartTab
}

export function ModelCharts(props: ModelChartsProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<ModelAnalyticsChartTab>(
    props.defaultChartTab ?? 'trend'
  )
  const timeGranularity = props.timeGranularity ?? DEFAULT_TIME_GRANULARITY

  useEffect(() => {
    if (props.defaultChartTab) setActiveTab(props.defaultChartTab)
  }, [props.defaultChartTab])

  const chartData = useMemo(
    () => processChartData(props.loading ? [] : props.data, timeGranularity, t),
    [props.data, props.loading, timeGranularity, t]
  )

  return (
    <div className='bg-card ring-border overflow-hidden rounded-2xl ring-1'>
      <div className='flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5'>
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5'>
          <IconBadge tone='chart-4' size='sm'>
            <PieChartIcon />
          </IconBadge>
          <div className='text-sm font-semibold'>
            {t('Model Call Analytics')}
          </div>
          <span className='text-muted-foreground text-xs whitespace-nowrap tabular-nums'>
            {t('Total:')} {chartData.totalCountDisplay}
          </span>
        </div>

        <div className='-mx-1 max-w-full overflow-x-auto px-1'>
          <SegmentedControl
            size='sm'
            aria-label={t('Chart type')}
            value={activeTab}
            onValueChange={setActiveTab}
            options={MODEL_ANALYTICS_CHART_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
          />
        </div>
      </div>

      <div className='h-[300px] p-2 sm:h-96 sm:p-3'>
        {activeTab === 'trend' && (
          <DashboardSeriesChartView
            chart={chartData.trendCount}
            variant='area'
          />
        )}
        {activeTab === 'proportion' && (
          <DashboardPieChartView chart={chartData.pie} />
        )}
        {activeTab === 'top' && (
          <DashboardRankChartView chart={chartData.rankCount} />
        )}
      </div>
    </div>
  )
}
