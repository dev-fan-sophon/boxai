import { queryOptions, useQuery } from '@tanstack/react-query'

import { getUserTaskLogs } from '@/features/usage-logs/api'
import type { TaskLog } from '@/features/usage-logs/types'

// Key by task so tiles and batch downloads share requests, independently of
// the paginated history and of unrelated tasks' lifecycles.
export function videoTaskQueryOptions(taskId: string | undefined) {
  return queryOptions({
    queryKey: ['playground', 'task-history', taskId],
    queryFn: async () => {
      const response = await getUserTaskLogs({
        p: 1,
        page_size: 1,
        task_id: taskId,
      })
      return (
        (response.data?.items as TaskLog[] | undefined)?.find(
          (item) => item.task_id === taskId
        ) ?? null
      )
    },
    enabled: Boolean(taskId),
    staleTime: 5000,
    refetchInterval: (query) =>
      query.state.data?.status === 'SUCCESS' ||
      query.state.data?.status === 'FAILURE'
        ? false
        : 5000,
  })
}

export type VideoTaskResult = {
  status?: string
  ready: boolean
  failed: boolean
  failReason?: string
  resultUrl: string
  percent: number | null
}

export function useVideoTaskResult(
  taskId: string | undefined,
  enabled: boolean
): VideoTaskResult {
  const query = useQuery({
    ...videoTaskQueryOptions(taskId),
    enabled: enabled && Boolean(taskId),
  })

  const task = enabled ? query.data : undefined

  const status = task?.status
  const ready = status === 'SUCCESS'
  const failed = status === 'FAILURE'
  const parsedPercent = Number.parseFloat(task?.progress ?? '')
  const percent = Number.isFinite(parsedPercent)
    ? Math.min(100, Math.max(0, parsedPercent))
    : null

  return {
    status,
    ready,
    failed,
    failReason: task?.fail_reason,
    resultUrl: ready && taskId ? `/v1/videos/${taskId}/content` : '',
    percent,
  }
}
