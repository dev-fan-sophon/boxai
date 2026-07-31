import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { DashboardSeriesChartView } from '@/features/dashboard/components/ui/dashboard-charts'
import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { formatNumber } from '@/lib/format'

import { getRevenueAnalytics } from '../../api'
import { buildDaySeriesChart, buildOpsTimeRange } from '../../lib/ops'

function money(value: number): string {
  return formatNumber(Math.round(value * 100) / 100)
}

export function RevenuePanel(props: { days: number }) {
  const { t } = useTranslation()
  const range = useMemo(() => buildOpsTimeRange(props.days), [props.days])

  const { data, isLoading } = useQuery({
    queryKey: ['user-ops', 'revenue', range],
    queryFn: () => getRevenueAnalytics(range),
    select: (res) => (res.success ? res.data : undefined),
    staleTime: 60_000,
  })

  const trend = useMemo(() => data?.trend ?? [], [data])
  const chart = useMemo(
    () =>
      buildDaySeriesChart(
        trend,
        [
          {
            key: 'topup_revenue',
            label: t('Top-ups'),
            value: (row) => Math.round(row.topup_revenue * 100) / 100,
          },
          {
            key: 'subscription_revenue',
            label: t('Subscriptions'),
            value: (row) => Math.round(row.subscription_revenue * 100) / 100,
          },
        ],
        t('Revenue')
      ),
    [trend, t]
  )
  const stackedChart = useMemo(() => ({ ...chart, stacked: true }), [chart])

  const channels = data?.channels ?? []
  const plans = data?.plans ?? []
  const buckets = data?.lifetime_buckets ?? []
  const maxBucket = Math.max(1, ...buckets.map((bucket) => bucket.users))

  return (
    <div className='space-y-3'>
      <PanelWrapper
        title={t('Revenue')}
        description={t('Successful top-ups and subscription orders per day')}
        loading={isLoading}
        empty={!isLoading && trend.length === 0}
        height='h-72'
      >
        <div className='h-72'>
          <DashboardSeriesChartView chart={stackedChart} variant='bar' />
        </div>
      </PanelWrapper>

      <div className='grid gap-3 xl:grid-cols-2'>
        <PanelWrapper
          title={t('Payment channels')}
          description={t('Order volume and success rate by provider')}
          loading={isLoading}
          empty={!isLoading && channels.length === 0}
          height='h-64'
          contentClassName='overflow-x-auto'
        >
          <table className='w-full text-xs'>
            <thead className='text-muted-foreground'>
              <tr>
                <th className='pb-2 text-left font-medium'>{t('Provider')}</th>
                <th className='pb-2 text-right font-medium'>{t('Orders')}</th>
                <th className='pb-2 text-right font-medium'>
                  {t('Success rate')}
                </th>
                <th className='pb-2 text-right font-medium'>{t('Revenue')}</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((channel) => {
                const rate =
                  channel.orders > 0
                    ? (channel.success_orders / channel.orders) * 100
                    : 0
                return (
                  <tr key={channel.provider || 'unknown'}>
                    <td className='py-1.5'>
                      {channel.provider || t('Unknown')}
                    </td>
                    <td className='py-1.5 text-right tabular-nums'>
                      {formatNumber(channel.orders)}
                    </td>
                    <td className='py-1.5 text-right tabular-nums'>
                      <Badge
                        variant={rate >= 80 ? 'default' : 'secondary'}
                        className='font-mono'
                      >
                        {Math.round(rate)}%
                      </Badge>
                    </td>
                    <td className='py-1.5 text-right tabular-nums'>
                      {money(channel.revenue)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </PanelWrapper>

        <PanelWrapper
          title={t('Subscription plans')}
          description={t('Active subscribers and new orders in the window')}
          loading={isLoading}
          empty={!isLoading && plans.length === 0}
          height='h-64'
          contentClassName='overflow-x-auto'
        >
          <table className='w-full text-xs'>
            <thead className='text-muted-foreground'>
              <tr>
                <th className='pb-2 text-left font-medium'>{t('Plan')}</th>
                <th className='pb-2 text-right font-medium'>{t('Active')}</th>
                <th className='pb-2 text-right font-medium'>{t('New')}</th>
                <th className='pb-2 text-right font-medium'>{t('Revenue')}</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.plan_id}>
                  <td className='py-1.5'>{plan.plan_name}</td>
                  <td className='py-1.5 text-right tabular-nums'>
                    {formatNumber(plan.active)}
                  </td>
                  <td className='py-1.5 text-right tabular-nums'>
                    {formatNumber(plan.new_sold)}
                  </td>
                  <td className='py-1.5 text-right tabular-nums'>
                    {money(plan.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PanelWrapper>
      </div>

      <PanelWrapper
        title={t('Lifetime spend distribution')}
        description={t(
          '{{repeat}} repeat buyers, {{first}} one-time buyers overall',
          {
            repeat: data?.repeat_buyers ?? 0,
            first: data?.first_time_buyers ?? 0,
          }
        )}
        loading={isLoading}
        empty={!isLoading && buckets.length === 0}
        height='h-48'
      >
        <div className='space-y-2'>
          {buckets.map((bucket) => (
            <div key={bucket.label} className='space-y-1'>
              <div className='flex items-baseline justify-between text-xs'>
                <span className='font-medium'>{bucket.label}</span>
                <span className='text-muted-foreground tabular-nums'>
                  {formatNumber(bucket.users)}
                </span>
              </div>
              <div className='bg-muted h-2 w-full overflow-hidden rounded-full'>
                <div
                  className='bg-primary h-full rounded-full'
                  style={{ width: `${(bucket.users / maxBucket) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </PanelWrapper>
    </div>
  )
}
