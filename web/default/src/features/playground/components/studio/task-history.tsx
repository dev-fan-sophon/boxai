/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { getUserTaskLogs } from '@/features/usage-logs/api'
import type { TaskLog } from '@/features/usage-logs/types'

export function TaskHistory() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['playground', 'task-history'],
    queryFn: () => getUserTaskLogs({ p: 1, page_size: 20 }),
    refetchInterval: (state) => {
      const items = (state.state.data?.data?.items ?? []) as TaskLog[]
      return items.some((item) =>
        ['SUBMITTED', 'IN_PROGRESS', 'QUEUED', 'NOT_START'].includes(
          item.status
        )
      )
        ? 5000
        : false
    },
  })
  const tasks = (query.data?.data?.items ?? []) as TaskLog[]

  return (
    <div className='bg-muted/20 flex h-full min-h-0 flex-col'>
      <div className='flex items-center justify-between border-b p-3'>
        <div>
          <h2 className='text-sm font-semibold text-balance'>
            {t('Task history')}
          </h2>
          <p className='text-muted-foreground text-xs text-pretty'>
            {t('Video and media tasks update automatically.')}
          </p>
        </div>
        <Button
          variant='ghost'
          size='icon'
          aria-label={t('Refresh tasks')}
          onClick={() => query.refetch()}
        >
          <RefreshCw className='size-4' />
        </Button>
      </div>
      <div className='min-h-0 flex-1 space-y-2 overflow-y-auto p-2'>
        {query.isLoading &&
          ['one', 'two', 'three', 'four'].map((key) => (
            <Skeleton key={key} className='h-24 w-full' />
          ))}
        {query.isError && (
          <HistoryState
            text={t('Tasks could not be loaded.')}
            action={t('Try again')}
            onAction={() => query.refetch()}
          />
        )}
        {!query.isLoading && !query.isError && tasks.length === 0 && (
          <HistoryState
            text={t('Your submitted media tasks will appear here.')}
            action={t('Refresh')}
            onAction={() => query.refetch()}
          />
        )}
        {tasks.map((task) => {
          const percent = Number.parseFloat(task.progress ?? '0')
          return (
            <article
              key={task.id}
              className='bg-background rounded-lg border p-3'
            >
              <div className='flex items-center justify-between gap-2'>
                <span className='truncate text-sm font-medium'>
                  {task.platform || task.action}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {t(task.status)}
                </span>
              </div>
              <p className='text-muted-foreground mt-1 truncate font-mono text-xs'>
                {task.task_id}
              </p>
              {Number.isFinite(percent) && percent > 0 && (
                <Progress value={percent} className='mt-2 h-1.5' />
              )}
              {task.status === 'SUCCESS' && (
                <a
                  className='text-primary mt-2 inline-flex items-center gap-1 text-xs hover:underline'
                  href={`/v1/videos/${task.task_id}/content`}
                  target='_blank'
                  rel='noreferrer'
                >
                  {t('Open result')}
                  <ExternalLink className='size-3' />
                </a>
              )}
              {task.fail_reason && (
                <p className='text-destructive mt-2 line-clamp-2 text-xs text-pretty'>
                  {task.fail_reason}
                </p>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}

function HistoryState(props: {
  text: string
  action: string
  onAction: () => void
}) {
  return (
    <div className='grid place-items-center gap-2 px-4 py-12 text-center'>
      <p className='text-muted-foreground text-sm text-pretty'>{props.text}</p>
      <Button size='sm' variant='outline' onClick={props.onAction}>
        {props.action}
      </Button>
    </div>
  )
}
