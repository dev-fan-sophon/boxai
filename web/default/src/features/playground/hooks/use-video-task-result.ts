import { useQuery } from '@tanstack/react-query'

import { getUserTaskLogs } from '@/features/usage-logs/api'
import type { TaskLog } from '@/features/usage-logs/types'

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
  enabled: boolean
): VideoTaskResult {
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
