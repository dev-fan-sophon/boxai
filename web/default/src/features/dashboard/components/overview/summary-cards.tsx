import NumberFlow from '@number-flow/react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import {
  Activity,
  Flame,
  Receipt,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
} from '@/components/icons'
import { StaggerContainer, StaggerItem } from '@/components/page-transition'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { getUserQuotaDates } from '@/features/dashboard/api'
import type { QuotaDataItem } from '@/features/dashboard/types'
import { getCurrentIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { computeTimeRange } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { AnimatedQuota } from '../ui/animated-quota'

const SUMMARY_BUCKETS = 24

function getBucketIndex(
  timestamp: number,
  start: number,
  end: number,
  bucketCount: number
): number {
  if (end <= start) return 0
  const ratio = (timestamp - start) / (end - start)
  return Math.min(bucketCount - 1, Math.max(0, Math.floor(ratio * bucketCount)))
}

function buildTrendRows(
  data: QuotaDataItem[],
  start: number,
  end: number
): Array<{ label: string; usage: number; requests: number }> {
  const usage = Array.from({ length: SUMMARY_BUCKETS }, () => 0)
  const requests = Array.from({ length: SUMMARY_BUCKETS }, () => 0)

  for (const item of data) {
    const timestamp = Number(item.created_at) || start
    const index = getBucketIndex(timestamp, start, end, SUMMARY_BUCKETS)
    usage[index] += Number(item.quota) || 0
    requests[index] += Number(item.count) || 0
  }

  const bucketSeconds = (end - start) / SUMMARY_BUCKETS
  const timeFormat = new Intl.DateTimeFormat(getCurrentIntlLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  })
  return usage.map((value, index) => ({
    label: timeFormat.format(new Date((start + index * bucketSeconds) * 1000)),
    usage: value,
    requests: requests[index],
  }))
}

function getRunwayDays(
  remainQuota: number,
  recentUsage: number
): number | null {
  if (remainQuota <= 0 || recentUsage <= 0) return null
  const days = remainQuota / recentUsage
  if (!Number.isFinite(days)) return null
  return days
}

type HealthLevel = 'healthy' | 'caution' | 'critical'

function getHealthLevel(remainQuota: number, recentUsage: number): HealthLevel {
  if (remainQuota <= 0) return 'critical'
  const days = getRunwayDays(remainQuota, recentUsage)
  if (days !== null && days < 3) return 'caution'
  return 'healthy'
}

const HEALTH_CONFIG: Record<
  HealthLevel,
  { dotClass: string; labelKey: string }
> = {
  healthy: { dotClass: 'bg-success', labelKey: 'Healthy' },
  caution: { dotClass: 'bg-warning', labelKey: 'Low balance' },
  critical: { dotClass: 'bg-destructive', labelKey: 'Balance depleted' },
}

export function SummaryCards() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const gradientId = useId().replaceAll(':', '')

  const summaryTimeRange = useMemo(() => computeTimeRange(1), [])
  const remainQuota = Number(user?.quota ?? 0)
  const usedQuota = Number(user?.used_quota ?? 0)
  const requestCount = Number(user?.request_count ?? 0)

  const usageTrendQuery = useQuery({
    queryKey: [
      'dashboard',
      'overview',
      'summary-sparklines',
      summaryTimeRange.start_timestamp,
      summaryTimeRange.end_timestamp,
    ],
    queryFn: async () =>
      getUserQuotaDates({
        start_timestamp: summaryTimeRange.start_timestamp,
        end_timestamp: summaryTimeRange.end_timestamp,
        default_time: 'hour',
      }),
    staleTime: 60 * 1000,
  })

  const trendRows = useMemo(
    () =>
      buildTrendRows(
        usageTrendQuery.data?.data ?? [],
        summaryTimeRange.start_timestamp,
        summaryTimeRange.end_timestamp
      ),
    [
      summaryTimeRange.end_timestamp,
      summaryTimeRange.start_timestamp,
      usageTrendQuery.data?.data,
    ]
  )

  const recentUsage = useMemo(
    () => trendRows.reduce((total, row) => total + row.usage, 0),
    [trendRows]
  )
  const recentRequests = useMemo(
    () => trendRows.reduce((total, row) => total + row.requests, 0),
    [trendRows]
  )

  const healthLevel = getHealthLevel(remainQuota, recentUsage)
  const healthCfg = HEALTH_CONFIG[healthLevel]
  const runwayDays = getRunwayDays(remainQuota, recentUsage)
  const loading = usageTrendQuery.isLoading

  let runwayDisplay: string
  if (runwayDays !== null) {
    if (runwayDays < 1) {
      runwayDisplay = t('Less than 1 day left')
    } else if (runwayDays > 999) {
      runwayDisplay = `999+ ${t('days')}`
    } else {
      runwayDisplay = `~${formatNumber(Math.floor(runwayDays))} ${t('days')}`
    }
  } else if (remainQuota <= 0) {
    runwayDisplay = t('Balance depleted')
  } else {
    runwayDisplay = t('No recent usage')
  }

  const chartConfig = {
    usage: { label: t('Last 24h usage'), color: 'var(--chart-1)' },
  } satisfies ChartConfig

  return (
    <StaggerContainer className='grid grid-cols-1 gap-3 lg:grid-cols-[minmax(17rem,0.85fr)_minmax(0,1.6fr)] lg:gap-4'>
      <StaggerItem className='flex min-w-0 flex-col gap-3 lg:gap-4'>
        <section className='bg-card ring-border relative flex flex-1 flex-col justify-between gap-5 overflow-hidden rounded-2xl p-5 ring-1'>
          <div className='flex flex-col gap-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <span className='text-muted-foreground min-w-0 text-sm font-medium'>
                {t('Credit remaining')}
              </span>
              <span className='bg-muted/60 inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5'>
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    healthCfg.dotClass,
                    healthLevel === 'healthy' && 'motion-safe:animate-pulse'
                  )}
                  aria-hidden='true'
                />
                <span className='text-muted-foreground text-2xs font-medium whitespace-nowrap'>
                  {t(healthCfg.labelKey)}
                </span>
              </span>
            </div>
            <AnimatedQuota
              quota={remainQuota}
              className='text-foreground block max-w-full truncate text-3xl leading-tight font-semibold tracking-tight sm:text-4xl'
            />
            <div className='bg-muted/50 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-3 py-2'>
              <div className='text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs font-medium'>
                {runwayDays !== null && runwayDays < 3 ? (
                  <TrendingDown
                    className='size-3.5 shrink-0'
                    aria-hidden='true'
                  />
                ) : (
                  <ShieldCheck
                    className='size-3.5 shrink-0'
                    aria-hidden='true'
                  />
                )}
                <span className='truncate'>{t('Runway')}</span>
              </div>
              <div
                className={cn(
                  'text-xs font-semibold tabular-nums',
                  healthLevel === 'critical' && 'text-destructive',
                  healthLevel === 'caution' && 'text-warning'
                )}
              >
                {runwayDisplay}
              </div>
            </div>
          </div>
          <div className='flex flex-wrap gap-2'>
            <Button className='flex-1' render={<Link to='/billing' />}>
              <Wallet data-icon='inline-start' />
              {t('Add credits')}
            </Button>
            <Button
              variant='outline'
              className='flex-1'
              render={
                <Link
                  to='/usage-logs/$section'
                  params={{ section: 'common' }}
                />
              }
            >
              <Receipt data-icon='inline-start' />
              {t('Usage Logs')}
            </Button>
          </div>
        </section>

        <div className='grid grid-cols-2 gap-3 lg:gap-4'>
          <StatCard
            label={t('Historical Usage')}
            value={<AnimatedQuota quota={usedQuota} />}
            valueTitle={formatQuota(usedQuota)}
            valueClassName='font-sans'
            icon={TrendingUp}
            iconTone='chart-2'
            className='rounded-2xl'
          />
          <StatCard
            label={t('Request Count')}
            value={
              <NumberFlow
                value={requestCount}
                locales={getCurrentIntlLocale()}
              />
            }
            valueTitle={formatNumber(requestCount)}
            valueClassName='font-sans'
            icon={Activity}
            iconTone='chart-3'
            className='rounded-2xl'
          />
        </div>
      </StaggerItem>

      <StaggerItem className='min-w-0'>
        <section className='bg-card ring-border flex h-full flex-col overflow-hidden rounded-2xl ring-1'>
          <div className='flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 pt-5'>
            <div className='flex min-w-0 items-center gap-2'>
              <IconBadge tone='chart-1' size='sm'>
                <Flame />
              </IconBadge>
              <h3 className='truncate text-sm font-semibold'>
                {t('Last 24h usage')}
              </h3>
            </div>
            <div className='flex min-w-0 flex-col items-end'>
              <AnimatedQuota
                quota={recentUsage}
                className='text-foreground text-xl font-semibold tracking-tight'
              />
              <span className='text-muted-foreground text-2xs tabular-nums'>
                {t('{{count}} requests', { count: recentRequests })}
              </span>
            </div>
          </div>
          <div className='min-h-56 flex-1 px-2 pt-2 pb-3 sm:min-h-64 sm:px-3'>
            {loading ? (
              <Skeleton className='h-full w-full' />
            ) : (
              <ChartContainer
                config={chartConfig}
                className='aspect-auto h-full w-full'
              >
                <AreaChart
                  data={trendRows}
                  margin={{ left: 4, right: 12, top: 8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id={gradientId} x1='0' y1='0' x2='0' y2='1'>
                      <stop
                        offset='0%'
                        stopColor='var(--chart-1)'
                        stopOpacity={0.32}
                      />
                      <stop
                        offset='100%'
                        stopColor='var(--chart-1)'
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray='3 3' />
                  <XAxis
                    dataKey='label'
                    tickLine={false}
                    axisLine={false}
                    interval='preserveStartEnd'
                    minTickGap={24}
                    tickMargin={8}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width='auto'
                    tickMargin={6}
                    allowDecimals
                    tickFormatter={(value) => formatQuota(Number(value) || 0)}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => (
                          <span className='font-sans font-medium tabular-nums'>
                            {formatQuota(Number(value) || 0)}
                          </span>
                        )}
                      />
                    }
                  />
                  <Area
                    type='monotoneX'
                    dataKey='usage'
                    stroke='var(--chart-1)'
                    fill={`url(#${gradientId})`}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2 }}
                    isAnimationActive
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </div>
        </section>
      </StaggerItem>
    </StaggerContainer>
  )
}
