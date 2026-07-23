/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'

import { getUserTaskLogs } from '@/features/usage-logs/api'
import type { TaskLog } from '@/features/usage-logs/types'

import { getManagedToolRun } from '../api'

const activeStatuses = new Set([
  'SUBMITTED',
  'IN_PROGRESS',
  'QUEUED',
  'NOT_START',
])

export type VideoTaskResult = {
  status?: string
  ready: boolean
  failed: boolean
  failReason?: string
  resultUrl: string
  percent: number | null
}

// useVideoTaskResult polls the shared task-history query and resolves a single
// submitted video task. It shares the ['playground','task-history'] cache with
// the task history panel, so no extra network polling is introduced.
export function useVideoTaskResult(
  taskId: string | undefined,
  enabled: boolean,
  runId?: number
): VideoTaskResult {
  const managedRun = useQuery({
    queryKey: ['playground', 'managed-tool-run', runId],
    queryFn: () => getManagedToolRun(runId as number),
    enabled: enabled && Boolean(runId),
    refetchInterval: (query) =>
      query.state.data?.run.status === 'submitted' ? 5000 : false,
  })
  const query = useQuery({
    queryKey: ['playground', 'task-history'],
    queryFn: () => getUserTaskLogs({ p: 1, page_size: 20 }),
    enabled: enabled && Boolean(taskId),
    refetchInterval: (state) => {
      const items = (state.state.data?.data?.items ?? []) as TaskLog[]
      return items.some((item) => activeStatuses.has(item.status))
        ? 5000
        : false
    },
  })

  const items = (query.data?.data?.items ?? []) as TaskLog[]
  const task = taskId
    ? items.find((item) => item.task_id === taskId)
    : undefined

  const snapshot = managedRun.data
  const status = snapshot?.run.status ?? task?.status
  const ready = status === 'completed' || status === 'SUCCESS'
  const failed = status === 'failed' || status === 'FAILURE'
  const parsedPercent = Number.parseFloat(task?.progress ?? '')
  const percent = Number.isFinite(parsedPercent)
    ? Math.min(100, Math.max(0, parsedPercent))
    : null

  return {
    status,
    ready,
    failed,
    failReason: snapshot?.run.error ?? task?.fail_reason,
    resultUrl:
      (snapshot?.result as { video_url?: string } | undefined)?.video_url ??
      (ready && taskId ? `/v1/videos/${taskId}/content` : ''),
    percent,
  }
}
