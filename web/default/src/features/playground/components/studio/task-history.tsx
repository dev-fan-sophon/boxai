/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ExternalLink, ListTodo, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { getUserTaskLogs } from '@/features/usage-logs/api'
import { TASK_ACTIONS } from '@/features/usage-logs/constants'
import { taskStatusMapper } from '@/features/usage-logs/lib/mappers'
import type { TaskLog } from '@/features/usage-logs/types'
import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

const videoActions = new Set<string>([
  TASK_ACTIONS.GENERATE,
  TASK_ACTIONS.TEXT_GENERATE,
  TASK_ACTIONS.FIRST_TAIL_GENERATE,
  TASK_ACTIONS.REFERENCE_GENERATE,
  TASK_ACTIONS.REMIX_GENERATE,
])

type TaskHistoryProps = {
  isAuthenticated: boolean
  highlightedTaskId?: string
  onSignIn: () => void
  /** dark workbench sheet styling */
  tone?: 'default' | 'workbench'
}

export function TaskHistory(props: TaskHistoryProps) {
  const { t } = useTranslation()
  const tone = props.tone ?? 'default'
  const isWb = tone === 'workbench'
  const query = useQuery({
    queryKey: ['playground', 'task-history'],
    queryFn: () => getUserTaskLogs({ p: 1, page_size: 20 }),
    enabled: props.isAuthenticated,
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
    <div
      className={cn(
        'flex h-full min-h-0 flex-col',
        isWb ? 'bg-transparent' : 'bg-muted/20'
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between p-3',
          isWb ? 'border-b border-border' : 'border-b'
        )}
      >
        <div>
          <h2
            className={cn(
              'text-sm font-semibold text-balance',
              isWb && 'text-foreground'
            )}
          >
            {t('Task history')}
          </h2>
          <p
            className={cn(
              'text-xs text-pretty',
              isWb ? 'text-muted-foreground' : 'text-muted-foreground'
            )}
          >
            {t('Video and media tasks update automatically.')}
          </p>
        </div>
        <Button
          variant='ghost'
          size='icon'
          className={isWb ? 'text-muted-foreground hover:bg-muted/50 hover:text-foreground' : undefined}
          aria-label={t('Refresh tasks')}
          onClick={() => {
            if (props.isAuthenticated) {
              query.refetch()
            } else {
              props.onSignIn()
            }
          }}
          disabled={props.isAuthenticated && query.isFetching}
        >
          <RefreshCw
            className={cn('size-4', query.isFetching && 'animate-spin')}
          />
        </Button>
      </div>
      <div className='min-h-0 flex-1 space-y-2 overflow-y-auto p-2'>
        {!props.isAuthenticated && (
          <HistoryState
            text={t('Please sign in to view {{module}}.', {
              module: t('Task history'),
            })}
            action={t('Sign in now')}
            onAction={props.onSignIn}
            workbench={isWb}
          />
        )}
        {props.isAuthenticated &&
          query.isLoading &&
          ['one', 'two', 'three', 'four'].map((key) => (
            <Skeleton
              key={key}
              className={cn('h-24 w-full', isWb && 'bg-muted/50')}
            />
          ))}
        {props.isAuthenticated && query.isError && (
          <HistoryState
            text={t('Tasks could not be loaded.')}
            action={t('Try again')}
            onAction={() => query.refetch()}
            workbench={isWb}
          />
        )}
        {props.isAuthenticated &&
          !query.isLoading &&
          !query.isError &&
          tasks.length === 0 && (
            <HistoryState
              text={t('Your submitted media tasks will appear here.')}
              action={t('Refresh')}
              onAction={() => query.refetch()}
              workbench={isWb}
            />
          )}
        {props.isAuthenticated &&
          tasks.map((task) => {
            const parsedPercent = Number.parseFloat(task.progress ?? '')
            const percent = Number.isFinite(parsedPercent)
              ? Math.min(100, Math.max(0, parsedPercent))
              : null
            const highlighted = props.highlightedTaskId === task.task_id
            const canOpenVideo =
              task.status === 'SUCCESS' &&
              videoActions.has(task.action) &&
              task.fail_reason?.startsWith('http')
            return (
              <article
                key={task.id}
                aria-current={highlighted ? 'true' : undefined}
                className={cn(
                  'rounded-lg border p-3 transition-colors',
                  isWb
                    ? 'border-border bg-muted/40'
                    : 'bg-background border',
                  highlighted &&
                    (isWb
                      ? 'border-primary/40 bg-primary/10'
                      : 'border-primary/40 bg-primary/5')
                )}
              >
                <div className='flex items-start justify-between gap-2'>
                  <span
                    className={cn(
                      'min-w-0 truncate text-sm font-medium',
                      isWb && 'text-foreground'
                    )}
                  >
                    {task.platform || task.action}
                  </span>
                  <StatusBadge
                    label={t(
                      taskStatusMapper.getLabel(task.status, task.status)
                    )}
                    variant={taskStatusMapper.getVariant(task.status)}
                    copyable={false}
                    size='sm'
                  />
                </div>
                <p
                  className={cn(
                    'mt-1 truncate font-mono text-xs',
                    isWb ? 'text-muted-foreground' : 'text-muted-foreground'
                  )}
                >
                  {task.task_id}
                </p>
                <p
                  className={cn(
                    'mt-1 text-[11px] tabular-nums',
                    isWb ? 'text-muted-foreground' : 'text-muted-foreground/70'
                  )}
                >
                  {formatTimestampToDate(task.submit_time, 'seconds')}
                </p>
                {percent !== null && percent > 0 && (
                  <Progress value={percent} className='mt-2 h-1.5' />
                )}
                {canOpenVideo && (
                  <a
                    className={cn(
                      'mt-2 inline-flex items-center gap-1 text-xs hover:underline',
                      isWb ? 'text-primary' : 'text-primary'
                    )}
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
      {props.isAuthenticated && (
        <div
          className={cn(
            'p-2',
            isWb ? 'border-t border-border' : 'border-t'
          )}
        >
          <Button
            render={
              <Link to='/usage-logs/$section' params={{ section: 'task' }} />
            }
            variant='ghost'
            size='sm'
            className={cn(
              'w-full justify-start',
              isWb && 'text-foreground/80 hover:bg-muted/50 hover:text-foreground'
            )}
          >
            <ListTodo className='size-4' />
            {t('View all task logs')}
          </Button>
        </div>
      )}
    </div>
  )
}

function HistoryState(props: {
  text: string
  action: string
  onAction: () => void
  workbench?: boolean
}) {
  return (
    <div className='grid place-items-center gap-2 px-4 py-12 text-center'>
      <p
        className={cn(
          'text-sm text-pretty',
          props.workbench ? 'text-muted-foreground' : 'text-muted-foreground'
        )}
      >
        {props.text}
      </p>
      <Button
        size='sm'
        variant='outline'
        className={
          props.workbench
            ? 'border-border bg-muted/50 text-foreground hover:bg-muted'
            : undefined
        }
        onClick={props.onAction}
      >
        {props.action}
      </Button>
    </div>
  )
}
