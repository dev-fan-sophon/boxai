import { useQuery } from '@tanstack/react-query'
import {
  BadgeDollarSign,
  CreditCard,
  TrendingUp,
  UserCheck,
  UserPlus,
  Wallet,
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { DashboardSeriesChartView } from '@/features/dashboard/components/ui/dashboard-charts'
import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { StatCard } from '@/features/dashboard/components/ui/stat-card'
import { formatNumber, formatQuota } from '@/lib/format'

import {
  getUserFunnel,
  getUserGrowthOverview,
  getUserRetention,
} from '../../api'
import {
  buildDaySeriesChart,
  buildOpsTimeRange,
  periodDelta,
} from '../../lib/ops'
import { FunnelPanel } from './funnel-panel'
import { RetentionPanel } from './retention-panel'

function deltaDescription(
  t: (key: string, options?: Record<string, unknown>) => string,
  current: number,
  previous: number
): string {
  const delta = periodDelta(current, previous)
  if (delta === null) {
    return t('No comparable previous period')
  }
  const rounded = Math.round(delta * 10) / 10
  if (rounded === 0) return t('Flat vs previous period')
  return rounded > 0
    ? t('Up {{value}}% vs previous period', { value: rounded })
    : t('Down {{value}}% vs previous period', { value: Math.abs(rounded) })
}

export function GrowthOverview(props: { days: number }) {
  const { t } = useTranslation()
  const range = useMemo(() => buildOpsTimeRange(props.days), [props.days])

  const overviewQuery = useQuery({
    queryKey: ['user-ops', 'overview', range],
    queryFn: () => getUserGrowthOverview(range),
    select: (res) => (res.success ? res.data : undefined),
    staleTime: 60_000,
  })
  const funnelQuery = useQuery({
    queryKey: ['user-ops', 'funnel', range],
    queryFn: () => getUserFunnel(range),
    select: (res) => (res.success ? (res.data ?? []) : []),
    staleTime: 60_000,
  })
  const retentionQuery = useQuery({
    queryKey: ['user-ops', 'retention', range],
    queryFn: () => getUserRetention(range),
    select: (res) => (res.success ? (res.data ?? []) : []),
    staleTime: 60_000,
  })

  const overview = overviewQuery.data
  const current = overview?.current
  const previous = overview?.previous
  const trend = useMemo(() => overview?.trend ?? [], [overview])

  const growthChart = useMemo(
    () =>
      buildDaySeriesChart(
        trend,
        [
          {
            key: 'new_users',
            label: t('New users'),
            value: (row) => row.new_users,
          },
          {
            key: 'active_users',
            label: t('Active users'),
            value: (row) => row.active_users,
          },
          {
            key: 'paying_users',
            label: t('Paying users'),
            value: (row) => row.paying_users,
          },
        ],
        t('User growth')
      ),
    [trend, t]
  )

  const revenueChart = useMemo(
    () =>
      buildDaySeriesChart(
        trend,
        [
          {
            key: 'revenue',
            label: t('Revenue'),
            value: (row) => Math.round(row.revenue * 100) / 100,
          },
        ],
        t('Revenue')
      ),
    [trend, t]
  )

  const loading = overviewQuery.isLoading
  const error = overviewQuery.isError

  const cards = [
    {
      key: 'new-users',
      title: t('New users'),
      value: formatNumber(current?.new_users ?? 0),
      description: deltaDescription(
        t,
        current?.new_users ?? 0,
        previous?.new_users ?? 0
      ),
      icon: UserPlus,
      sparkline: trend.map((point) => point.new_users),
      tone: 'accent-1' as const,
    },
    {
      key: 'active-users',
      title: t('Active users'),
      value: formatNumber(current?.active_users ?? 0),
      description: deltaDescription(
        t,
        current?.active_users ?? 0,
        previous?.active_users ?? 0
      ),
      icon: UserCheck,
      sparkline: trend.map((point) => point.active_users),
      tone: 'accent-2' as const,
    },
    {
      key: 'paying-users',
      title: t('Paying users'),
      value: formatNumber(current?.paying_users ?? 0),
      description: t('{{count}} first-time buyers', {
        count: current?.new_paying_users ?? 0,
      }),
      icon: CreditCard,
      sparkline: trend.map((point) => point.paying_users),
      tone: 'accent-3' as const,
    },
    {
      key: 'revenue',
      title: t('Revenue'),
      value: formatNumber(Math.round((current?.revenue ?? 0) * 100) / 100),
      description: deltaDescription(
        t,
        current?.revenue ?? 0,
        previous?.revenue ?? 0
      ),
      icon: BadgeDollarSign,
      sparkline: trend.map((point) => point.revenue),
      tone: 'accent-1' as const,
    },
    {
      key: 'arpu',
      title: t('ARPU / ARPPU'),
      value: `${(current?.arpu ?? 0).toFixed(2)} / ${(current?.arppu ?? 0).toFixed(2)}`,
      description: t('{{count}} paid orders', {
        count: current?.paid_orders ?? 0,
      }),
      icon: TrendingUp,
      sparkline: trend.map((point) => point.revenue),
      tone: 'accent-2' as const,
    },
    {
      key: 'balance',
      title: t('Outstanding balance'),
      value: formatQuota(current?.outstanding_quota ?? 0),
      description: t('Quota consumed: {{value}}', {
        value: formatQuota(current?.quota_consumed ?? 0),
      }),
      icon: Wallet,
      sparkline: trend.map((point) => point.quota),
      tone: 'accent-3' as const,
    },
  ]

  return (
    <div className='space-y-3'>
      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
        {cards.map((card) => (
          <div
            key={card.key}
            className='bg-card ring-border rounded-xl p-3 ring-1 sm:p-4'
          >
            <StatCard
              title={card.title}
              value={card.value}
              description={card.description}
              icon={card.icon}
              sparkline={card.sparkline}
              sparklineVariant='line'
              tone={card.tone}
              loading={loading}
              error={error}
            />
          </div>
        ))}
      </div>

      <div className='grid gap-3 xl:grid-cols-2'>
        <PanelWrapper
          title={t('User growth')}
          description={t('New, active, and paying users per day')}
          loading={loading}
          empty={!loading && trend.length === 0}
          height='h-72'
        >
          <div className='h-72'>
            <DashboardSeriesChartView chart={growthChart} variant='area' />
          </div>
        </PanelWrapper>
        <PanelWrapper
          title={t('Revenue')}
          description={t('Successful top-ups and subscription orders per day')}
          loading={loading}
          empty={!loading && trend.length === 0}
          height='h-72'
        >
          <div className='h-72'>
            <DashboardSeriesChartView chart={revenueChart} variant='bar' />
          </div>
        </PanelWrapper>
      </div>

      <div className='grid gap-3 xl:grid-cols-2'>
        <FunnelPanel
          stages={funnelQuery.data ?? []}
          loading={funnelQuery.isLoading}
        />
        <RetentionPanel
          cohorts={retentionQuery.data ?? []}
          loading={retentionQuery.isLoading}
        />
      </div>
    </div>
  )
}
