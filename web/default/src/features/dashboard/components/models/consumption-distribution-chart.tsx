import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AreaChart, BarChart3, WalletCards } from '@/components/icons'
import { IconBadge } from '@/components/ui/icon-badge'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  CONSUMPTION_DISTRIBUTION_CHART_OPTIONS,
  DEFAULT_TIME_GRANULARITY,
} from '@/features/dashboard/constants'
import { processChartData } from '@/features/dashboard/lib'
import type {
  ConsumptionDistributionChartType,
  QuotaDataItem,
} from '@/features/dashboard/types'
import type { TimeGranularity } from '@/lib/time'

import { DashboardSeriesChartView } from '../ui/dashboard-charts'

interface ConsumptionDistributionChartProps {
  data: QuotaDataItem[]
  loading?: boolean
  timeGranularity?: TimeGranularity
  defaultChartType?: ConsumptionDistributionChartType
}

const CHART_TYPE_ICONS: Record<ConsumptionDistributionChartType, ReactNode> = {
  bar: <BarChart3 aria-hidden='true' />,
  area: <AreaChart aria-hidden='true' />,
}

export function ConsumptionDistributionChart(
  props: ConsumptionDistributionChartProps
) {
  const { t } = useTranslation()
  const [chartType, setChartType] = useState<ConsumptionDistributionChartType>(
    props.defaultChartType ?? 'bar'
  )
  const timeGranularity = props.timeGranularity ?? DEFAULT_TIME_GRANULARITY

  useEffect(() => {
    if (props.defaultChartType) setChartType(props.defaultChartType)
  }, [props.defaultChartType])

  const chartData = useMemo(
    () => processChartData(props.loading ? [] : props.data, timeGranularity, t),
    [props.data, props.loading, timeGranularity, t]
  )

  const activeChart =
    chartType === 'bar' ? chartData.stackedQuota : chartData.areaQuota

  return (
    <div className='bg-card ring-border overflow-hidden rounded-2xl ring-1'>
      <div className='flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5'>
        <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5'>
          <IconBadge tone='chart-2' size='sm'>
            <WalletCards />
          </IconBadge>
          <div className='text-sm font-semibold'>{t(activeChart.title)}</div>
          <span className='text-muted-foreground text-xs whitespace-nowrap tabular-nums'>
            {t('Total:')} {chartData.totalQuotaDisplay}
          </span>
        </div>

        <div className='-mx-1 max-w-full overflow-x-auto px-1'>
          <SegmentedControl
            size='sm'
            aria-label={t('Chart type')}
            value={chartType}
            onValueChange={setChartType}
            options={CONSUMPTION_DISTRIBUTION_CHART_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
              icon: CHART_TYPE_ICONS[option.value],
            }))}
          />
        </div>
      </div>

      <div className='h-[300px] p-2 sm:h-96 sm:p-3'>
        <DashboardSeriesChartView
          chart={activeChart}
          variant={chartType === 'bar' ? 'bar' : 'area'}
        />
      </div>
    </div>
  )
}
