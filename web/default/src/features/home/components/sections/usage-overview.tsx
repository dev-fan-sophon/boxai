/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { toIntlLocale } from '@/i18n/languages'

import { useHomeStats } from '../../hooks'

export function UsageOverview() {
  const { i18n, t } = useTranslation()
  const statsQuery = useHomeStats()
  const stats = statsQuery.data?.data
  const intlLocale = toIntlLocale(i18n.language)
  const numberFormatter = new Intl.NumberFormat(intlLocale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  })

  const metrics = stats
    ? [
        {
          label: t('Available Models'),
          value: numberFormatter.format(stats.available_models),
        },
        {
          label: t('Model Providers'),
          value: numberFormatter.format(stats.active_vendors),
        },
        {
          label: t('Supported Endpoint Types'),
          value: numberFormatter.format(stats.endpoint_types),
        },
        {
          label: t('Tokens'),
          value: numberFormatter.format(stats.total_tokens),
        },
      ]
    : []

  if (stats && stats.request_count !== null) {
    metrics.push({
      label: t('Performance samples'),
      value: numberFormatter.format(stats.request_count),
    })
  }
  if (stats && stats.success_rate !== null) {
    metrics.push({
      label: t('Success rate'),
      value: `${stats.success_rate.toFixed(1)}%`,
    })
  }
  if (stats && stats.avg_latency_ms !== null) {
    metrics.push({
      label: t('Avg latency'),
      value: `${numberFormatter.format(stats.avg_latency_ms)} ms`,
    })
  }

  const maxTokens = Math.max(
    ...(stats?.trend.map((point) => point.tokens) ?? [])
  )
  const hasTokenUsage = (stats?.total_tokens ?? 0) > 0
  const hasPerformance = stats ? stats.request_count !== null : false

  return (
    <section
      aria-label={t('Usage Overview')}
      className='border-border/40 relative z-10 border-t px-6 py-24 md:py-32'
    >
      <div className='mx-auto max-w-6xl'>
        <AnimateInView className='mb-12 max-w-2xl'>
          <p className='text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase'>
            {t('Live Platform Data')}
          </p>
          <h2 className='text-2xl font-bold tracking-tight md:text-3xl'>
            {t('Real Platform Activity')}
          </h2>
          <p className='text-muted-foreground mt-3 text-sm leading-relaxed md:text-base'>
            {t(
              'Availability comes from the current model catalog. Usage and measured performance come from actual API traffic.'
            )}
          </p>
        </AnimateInView>

        <AnimateInView
          delay={80}
          className='border-border/50 bg-background/70 overflow-hidden rounded-2xl border shadow-[0_20px_50px_-30px_rgba(15,23,42,0.25)] backdrop-blur-sm'
        >
          <div className='border-border/40 flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 md:px-6'>
            <div>
              <h3 className='text-base font-semibold'>{t('Usage Overview')}</h3>
              <p className='text-muted-foreground text-xs'>
                {t('Last 30 days')}
              </p>
            </div>
            {stats && (
              <p className='text-muted-foreground text-xs'>
                {t('Updated {{time}}', {
                  time: new Intl.DateTimeFormat(intlLocale, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(stats.updated_at * 1000),
                })}
              </p>
            )}
          </div>

          {statsQuery.isLoading && (
            <div className='grid gap-4 p-5 sm:grid-cols-2 md:grid-cols-4 md:p-6'>
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={index}
                  className='bg-muted/50 h-24 animate-pulse rounded-xl'
                />
              ))}
            </div>
          )}

          {statsQuery.isError && !stats && (
            <div className='text-muted-foreground px-6 py-14 text-center text-sm'>
              {t(
                'Platform data is temporarily unavailable. Please try again later.'
              )}
            </div>
          )}

          {stats && (
            <>
              <div className='grid gap-4 p-5 sm:grid-cols-2 md:grid-cols-4 md:p-6'>
                {metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className='border-border/40 bg-muted/20 rounded-xl border p-4'
                  >
                    <div className='text-muted-foreground text-xs'>
                      {metric.label}
                    </div>
                    <div className='mt-2 text-2xl font-bold tracking-tight tabular-nums'>
                      {metric.value}
                    </div>
                  </div>
                ))}
              </div>

              {!hasPerformance && (
                <p className='text-muted-foreground mx-5 mb-5 text-sm md:mx-6'>
                  {t('No performance samples were recorded for this period.')}
                </p>
              )}

              {!hasTokenUsage ? (
                <div className='border-border/40 bg-muted/10 mx-5 mb-5 rounded-xl border px-6 py-12 text-center md:mx-6 md:mb-6'>
                  <p className='font-medium'>
                    {t('No recorded token usage for this period')}
                  </p>
                  <p className='text-muted-foreground mt-2 text-sm'>
                    {t(
                      'Token trends and top models will appear after token usage is recorded.'
                    )}
                  </p>
                </div>
              ) : (
                <div className='grid gap-4 px-5 pb-5 md:grid-cols-5 md:px-6 md:pb-6'>
                  <div className='border-border/40 bg-muted/10 rounded-xl border p-4 md:col-span-3'>
                    <h4 className='mb-4 text-sm font-semibold'>
                      {t('Token Usage Trend')}
                    </h4>
                    <div className='flex h-36 items-end gap-1'>
                      {stats.trend.map((point) => (
                        <div
                          key={point.ts}
                          title={`${new Intl.DateTimeFormat(intlLocale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(point.ts * 1000)}: ${numberFormatter.format(point.tokens)}`}
                          className='min-h-px w-full rounded-t-sm bg-gradient-to-t from-blue-500/80 to-violet-500/60'
                          style={{
                            height: `${maxTokens > 0 ? (point.tokens / maxTokens) * 100 : 0}%`,
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className='border-border/40 bg-muted/10 rounded-xl border p-4 md:col-span-2'>
                    <div className='mb-4 flex items-center justify-between'>
                      <h4 className='text-sm font-semibold'>
                        {t('Top Models')}
                      </h4>
                      <span className='text-muted-foreground text-xs'>
                        {t('By token usage')}
                      </span>
                    </div>
                    <div className='space-y-3'>
                      {stats.top_models.map((model) => (
                        <div key={model.model_name}>
                          <div className='mb-1 flex items-center justify-between gap-3 text-xs'>
                            <span className='truncate font-medium'>
                              {model.model_name}
                            </span>
                            <span className='text-muted-foreground tabular-nums'>
                              {(model.share * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className='bg-muted h-1.5 overflow-hidden rounded-full'>
                            <div
                              className='h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500'
                              style={{ width: `${model.share * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </AnimateInView>
      </div>
    </section>
  )
}
