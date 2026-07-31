import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SideDrawerSection,
  sideDrawerContentClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { DashboardSeriesChartView } from '@/features/dashboard/components/ui/dashboard-charts'
import { formatNumber, formatQuota, formatTimestamp } from '@/lib/format'

import { getAdminUserProfile } from '../../api'
import { buildDaySeriesChart } from '../../lib/ops'

function KeyValueRow(props: { label: string; value: React.ReactNode }) {
  return (
    <div className='flex items-baseline justify-between gap-3 text-xs'>
      <span className='text-muted-foreground'>{props.label}</span>
      <span className='min-w-0 truncate text-right font-medium'>
        {props.value}
      </span>
    </div>
  )
}

export function UserProfileDrawer(props: {
  userId: number | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const userId = props.userId

  const { data, isLoading } = useQuery({
    queryKey: ['user-ops', 'profile', userId],
    queryFn: () => getAdminUserProfile(userId as number),
    select: (res) => (res.success ? res.data : undefined),
    enabled: userId != null,
  })

  const metrics = useMemo(() => data?.daily_metrics ?? [], [data])
  const usageChart = useMemo(
    () =>
      buildDaySeriesChart(
        metrics,
        [
          {
            key: 'quota',
            label: t('Quota'),
            value: (row) => row.quota,
          },
          {
            key: 'requests',
            label: t('Requests'),
            value: (row) => row.requests,
          },
        ],
        t('Consumption')
      ),
    [metrics, t]
  )

  const lifecycle = data?.lifecycle
  const user = data?.user

  return (
    <Sheet open={userId != null} onOpenChange={props.onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[640px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {user ? `${user.username} #${user.id}` : t('User details')}
          </SheetTitle>
          <SheetDescription>
            {user?.email || t('Full customer profile and activity history')}
          </SheetDescription>
        </SheetHeader>

        <div className={sideDrawerFormClassName()}>
          {isLoading && (
            <div className='space-y-3'>
              <Skeleton className='h-24 w-full' />
              <Skeleton className='h-48 w-full' />
              <Skeleton className='h-32 w-full' />
            </div>
          )}

          {!isLoading && data && (
            <>
              <SideDrawerSection>
                <h3 className='text-sm font-medium'>{t('Profile')}</h3>
                {data.tags.length > 0 && (
                  <div className='flex flex-wrap gap-1.5'>
                    {data.tags.map((tag) => (
                      <Badge key={tag} variant='secondary'>
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className='grid gap-2 sm:grid-cols-2'>
                  <KeyValueRow label={t('Group')} value={user?.group ?? '-'} />
                  <KeyValueRow
                    label={t('Balance')}
                    value={formatQuota(user?.quota ?? 0)}
                  />
                  <KeyValueRow
                    label={t('Registered')}
                    value={
                      user?.created_at ? formatTimestamp(user.created_at) : '-'
                    }
                  />
                  <KeyValueRow
                    label={t('Last login')}
                    value={
                      user?.last_login_at
                        ? formatTimestamp(user.last_login_at)
                        : '-'
                    }
                  />
                  <KeyValueRow
                    label={t('Signup channel')}
                    value={user?.register_source || t('Unknown')}
                  />
                  <KeyValueRow
                    label={t('UTM source')}
                    value={user?.utm_source || t('Unknown')}
                  />
                  <KeyValueRow
                    label={t('Inviter')}
                    value={
                      data.inviter
                        ? `${data.inviter.username} #${data.inviter.id}`
                        : '-'
                    }
                  />
                  <KeyValueRow
                    label={t('Invited users')}
                    value={formatNumber(data.invitee_count)}
                  />
                  <KeyValueRow
                    label={t('API keys')}
                    value={formatNumber(data.token_count)}
                  />
                  <KeyValueRow
                    label={t('Check-ins')}
                    value={formatNumber(data.checkin_count)}
                  />
                </div>
              </SideDrawerSection>

              <SideDrawerSection>
                <h3 className='text-sm font-medium'>{t('Lifecycle')}</h3>
                <div className='grid gap-2 sm:grid-cols-2'>
                  <KeyValueRow
                    label={t('First call')}
                    value={
                      lifecycle?.first_active_at
                        ? formatTimestamp(lifecycle.first_active_at)
                        : t('Never')
                    }
                  />
                  <KeyValueRow
                    label={t('Last call')}
                    value={
                      lifecycle?.last_active_at
                        ? formatTimestamp(lifecycle.last_active_at)
                        : t('Never')
                    }
                  />
                  <KeyValueRow
                    label={t('Active days')}
                    value={formatNumber(lifecycle?.active_days ?? 0)}
                  />
                  <KeyValueRow
                    label={t('Active days (30d)')}
                    value={formatNumber(lifecycle?.active_days_30 ?? 0)}
                  />
                  <KeyValueRow
                    label={t('Lifetime spend')}
                    value={formatNumber(
                      Math.round((lifecycle?.topup_money ?? 0) * 100) / 100
                    )}
                  />
                  <KeyValueRow
                    label={t('Paid orders')}
                    value={formatNumber(lifecycle?.topup_count ?? 0)}
                  />
                </div>
                <div className='h-56'>
                  <DashboardSeriesChartView chart={usageChart} variant='area' />
                </div>
              </SideDrawerSection>

              <SideDrawerSection>
                <h3 className='text-sm font-medium'>{t('Top models')}</h3>
                <div className='space-y-1.5'>
                  {data.top_models.map((usage) => (
                    <KeyValueRow
                      key={usage.model_name}
                      label={usage.model_name}
                      value={`${formatQuota(usage.quota)} · ${formatNumber(usage.requests)}`}
                    />
                  ))}
                  {data.top_models.length === 0 && (
                    <p className='text-muted-foreground text-xs'>
                      {t('No data available')}
                    </p>
                  )}
                </div>
              </SideDrawerSection>

              <SideDrawerSection>
                <h3 className='text-sm font-medium'>{t('Recent orders')}</h3>
                <div className='space-y-1.5'>
                  {data.top_ups.map((order) => (
                    <KeyValueRow
                      key={order.id}
                      label={`${order.payment_provider || order.payment_method} · ${order.status}`}
                      value={`${order.money} · ${formatTimestamp(order.create_time)}`}
                    />
                  ))}
                  {data.top_ups.length === 0 && (
                    <p className='text-muted-foreground text-xs'>
                      {t('No data available')}
                    </p>
                  )}
                </div>
              </SideDrawerSection>

              <SideDrawerSection>
                <h3 className='text-sm font-medium'>{t('Recent logins')}</h3>
                <div className='space-y-1.5'>
                  {(data.login_events ?? []).map((event) => (
                    <KeyValueRow
                      key={event.id}
                      label={formatTimestamp(event.created_at)}
                      value={`${event.content} · ${event.ip}`}
                    />
                  ))}
                  {(data.login_events ?? []).length === 0 && (
                    <p className='text-muted-foreground text-xs'>
                      {t('No data available')}
                    </p>
                  )}
                </div>
              </SideDrawerSection>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
