import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { DashboardRankChartView } from '@/features/dashboard/components/ui/dashboard-charts'
import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { formatNumber } from '@/lib/format'

import { getAcquisitionAnalytics } from '../../api'
import { buildChannelRankChart, buildOpsTimeRange } from '../../lib/ops'
import type { AcquisitionChannelStat } from '../../types'

function ChannelTable(props: {
  stats: AcquisitionChannelStat[]
  title: string
  description: string
  loading?: boolean
}) {
  const { t } = useTranslation()

  return (
    <PanelWrapper
      title={props.title}
      description={props.description}
      loading={props.loading}
      empty={!props.loading && props.stats.length === 0}
      height='h-64'
      contentClassName='overflow-x-auto'
    >
      <table className='w-full text-xs'>
        <thead className='text-muted-foreground'>
          <tr>
            <th className='pb-2 text-left font-medium'>{t('Channel')}</th>
            <th className='pb-2 text-right font-medium'>{t('Users')}</th>
            <th className='pb-2 text-right font-medium'>{t('Activated')}</th>
            <th className='pb-2 text-right font-medium'>{t('Paid')}</th>
            <th className='pb-2 text-right font-medium'>{t('Revenue')}</th>
          </tr>
        </thead>
        <tbody>
          {props.stats.map((stat) => (
            <tr key={stat.channel}>
              <td className='py-1.5'>
                {stat.channel === 'unknown' ? t('Unknown') : stat.channel}
              </td>
              <td className='py-1.5 text-right tabular-nums'>
                {formatNumber(stat.users)}
              </td>
              <td className='py-1.5 text-right tabular-nums'>
                {formatNumber(stat.activated)}
              </td>
              <td className='py-1.5 text-right tabular-nums'>
                {formatNumber(stat.paid)}
              </td>
              <td className='py-1.5 text-right tabular-nums'>
                {formatNumber(Math.round(stat.revenue * 100) / 100)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </PanelWrapper>
  )
}

export function AcquisitionPanel(props: { days: number }) {
  const { t } = useTranslation()
  const range = useMemo(() => buildOpsTimeRange(props.days), [props.days])

  const { data, isLoading } = useQuery({
    queryKey: ['user-ops', 'acquisition', range],
    queryFn: () => getAcquisitionAnalytics(range),
    select: (res) => (res.success ? res.data : undefined),
    staleTime: 60_000,
  })

  const sources = useMemo(() => data?.sources ?? [], [data])
  const utmSources = data?.utm_sources ?? []
  const campaigns = data?.campaigns ?? []
  const inviters = data?.top_inviters ?? []

  const sourceChart = useMemo(
    () => buildChannelRankChart(sources, t('Signup channel'), t),
    [sources, t]
  )

  return (
    <div className='space-y-3'>
      <div className='grid gap-3 xl:grid-cols-2'>
        <PanelWrapper
          title={t('Signup channel')}
          description={t('How users registered in the selected window')}
          loading={isLoading}
          empty={!isLoading && sources.length === 0}
          height='h-64'
        >
          <div className='h-64'>
            <DashboardRankChartView chart={sourceChart} />
          </div>
        </PanelWrapper>
        <ChannelTable
          stats={sources}
          title={t('Signup channel breakdown')}
          description={t('Activation and payment rate per signup channel')}
          loading={isLoading}
        />
      </div>

      <div className='grid gap-3 xl:grid-cols-2'>
        <ChannelTable
          stats={utmSources}
          title={t('UTM source')}
          description={t('First-touch attribution captured at landing')}
          loading={isLoading}
        />
        <ChannelTable
          stats={campaigns}
          title={t('UTM campaign')}
          description={t('Campaign attribution captured at landing')}
          loading={isLoading}
        />
      </div>

      <PanelWrapper
        title={t('Top referrers')}
        description={t('Affiliates ranked by users invited in the window')}
        loading={isLoading}
        empty={!isLoading && inviters.length === 0}
        height='h-64'
        contentClassName='overflow-x-auto'
      >
        <table className='w-full text-xs'>
          <thead className='text-muted-foreground'>
            <tr>
              <th className='pb-2 text-left font-medium'>{t('Referrer')}</th>
              <th className='pb-2 text-right font-medium'>{t('Invited')}</th>
              <th className='pb-2 text-right font-medium'>
                {t('Invited who paid')}
              </th>
              <th className='pb-2 text-right font-medium'>{t('Revenue')}</th>
            </tr>
          </thead>
          <tbody>
            {inviters.map((inviter) => (
              <tr key={inviter.user_id}>
                <td className='py-1.5'>
                  {inviter.username}
                  <span className='text-muted-foreground ml-1'>
                    #{inviter.user_id}
                  </span>
                </td>
                <td className='py-1.5 text-right tabular-nums'>
                  {formatNumber(inviter.invited)}
                </td>
                <td className='py-1.5 text-right tabular-nums'>
                  {formatNumber(inviter.paid_invited)}
                </td>
                <td className='py-1.5 text-right tabular-nums'>
                  {formatNumber(Math.round(inviter.revenue * 100) / 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PanelWrapper>
    </div>
  )
}
