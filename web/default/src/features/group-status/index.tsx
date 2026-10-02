import NumberFlow from '@number-flow/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import {
  Activity,
  AlertTriangle,
  Eye,
  RefreshCw,
  ShieldCheck,
} from '@/components/icons'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'

import { getUserGroupStatus } from './api'
import { ModelStatusCard } from './components/model-status-card'
import { summarizeGroups } from './lib/status'

export function GroupStatusPage() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['user-group-status'],
    queryFn: getUserGroupStatus,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  })

  const groups = query.data?.data ?? []
  const summary = summarizeGroups(groups)

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Group status')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch()
          }}
        >
          <RefreshCw
            data-icon='inline-start'
            className={query.isFetching ? 'animate-spin' : undefined}
          />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='mx-auto flex w-full max-w-6xl flex-col gap-5'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Check model availability by group, recent success rates, and performance over time.'
            )}
          </p>
          <section className='bg-card ring-border overflow-hidden rounded-2xl ring-1'>
            <div className='border-b px-5 py-4'>
              <h3 className='text-sm font-semibold'>
                {t('Group model status')}
              </h3>
              <p className='text-muted-foreground mt-0.5 text-xs'>
                {t(
                  'Quickly see which models are stable, which have recent volatility, and roughly when issues appeared.'
                )}
              </p>
            </div>
            {query.isLoading ? (
              <SummarySkeleton />
            ) : (
              <div className='bg-border grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1'>
                <SummaryCell
                  label={t('Business groups')}
                  value={summary.groupCount}
                  hint={t('Groups you can view')}
                  icon={Activity}
                  tone='info'
                />
                <SummaryCell
                  label={t('Healthy models')}
                  value={summary.healthy}
                  hint={t('{{total}} models total', {
                    total: summary.totalModels,
                  })}
                  icon={ShieldCheck}
                  tone='success'
                />
                <SummaryCell
                  label={t('Slow models')}
                  value={summary.slow}
                  hint={t('Last 30 minutes success window')}
                  icon={AlertTriangle}
                  tone='warning'
                />
                <SummaryCell
                  label={t('Faulty models')}
                  value={summary.down}
                  hint={t('Last 30 minutes success window')}
                  icon={AlertTriangle}
                  tone='destructive'
                />
                <SummaryCell
                  label={t('Observing models')}
                  value={summary.observing}
                  hint={t('Not enough request samples')}
                  icon={Eye}
                  tone='chart-4'
                />
              </div>
            )}
          </section>

          {query.isError && (
            <ErrorState
              className='min-h-[200px] border border-dashed'
              title={t('Unable to load group status')}
              description={
                query.error instanceof Error
                  ? query.error.message
                  : t('Please try again later.')
              }
              onRetry={() => void query.refetch()}
            />
          )}

          {!query.isLoading && !query.isError && groups.length === 0 && (
            <EmptyState
              icon={Activity}
              className='min-h-[200px]'
              title={t('No group metrics yet')}
              description={t(
                'Availability is computed from real relay traffic. After models receive requests, success-rate windows will appear here. Ensure performance metrics collection is enabled.'
              )}
            />
          )}

          {groups.map((group) => {
            const models = group.models ?? []
            return (
              <section key={group.group} className='space-y-3'>
                <div className='flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1'>
                  <h3 className='min-w-0 truncate text-base font-semibold tracking-tight'>
                    {group.group}
                  </h3>
                  <span className='text-muted-foreground text-sm tabular-nums'>
                    {t('{{count}} models', { count: models.length })}
                  </span>
                </div>
                {models.length === 0 ? (
                  <div className='bg-surface-subtle text-muted-foreground flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm'>
                    <Eye className='size-4 shrink-0' aria-hidden='true' />
                    <span className='min-w-0'>
                      {t('No model traffic in this group during the window.')}
                    </span>
                  </div>
                ) : (
                  <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
                    {models.map((model) => (
                      <ModelStatusCard
                        key={`${group.group}:${model.model}`}
                        model={model}
                      />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function SummaryCell(props: {
  label: string
  value: number
  hint: string
  icon: typeof Activity
  tone: IconBadgeTone
}) {
  const Icon = props.icon
  return (
    <div className='bg-card min-w-0 px-4 py-4 sm:px-5'>
      <div className='flex min-w-0 items-start gap-2'>
        <IconBadge tone={props.tone} size='stat' className='shrink-0'>
          <Icon />
        </IconBadge>
        <span className='text-muted-foreground line-clamp-2 min-w-0 text-xs font-medium'>
          {props.label}
        </span>
      </div>
      <NumberFlow
        className='mt-2 block text-2xl font-semibold tracking-tight tabular-nums'
        value={props.value}
      />
      <p className='text-muted-foreground mt-1 hidden text-xs sm:block'>
        {props.hint}
      </p>
    </div>
  )
}

function SummarySkeleton() {
  return (
    <div className='bg-border grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-5'>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className='bg-card space-y-2 px-4 py-4'>
          <Skeleton className='h-4 w-20' />
          <Skeleton className='h-7 w-12' />
          <Skeleton className='hidden h-3 w-28 sm:block' />
        </div>
      ))}
    </div>
  )
}
