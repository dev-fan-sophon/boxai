import {
  importPlaygroundAsset,
  uploadPlaygroundAsset,
} from '@/features/playground/api'
import { getUserTaskLogs } from '@/features/usage-logs/api'
import type { TaskLog } from '@/features/usage-logs/types'

import { captureVideoLastFrame } from './video-frames'

/** Fresh state of one video task (no cache: the last frame appears at finish). */
export async function fetchVideoTask(taskId: string): Promise<TaskLog | null> {
  const response = await getUserTaskLogs({
    p: 1,
    page_size: 1,
    task_id: taskId,
  })
  const items = (response.data?.items as TaskLog[] | undefined) ?? []
  return items.find((item) => item.task_id === taskId) ?? null
}

/**
 * Returns a durable, provider-readable reference to the final frame of a
 * finished video. Prefers the frame the provider returned (Seedance
 * `return_last_frame`), archived as a private asset because provider links
 * expire; otherwise captures the last frame from the same-origin video
 * stream and uploads it.
 */
export async function resolveVideoLastFrame(input: {
  taskId?: string
  videoSrc?: string
}): Promise<string> {
  const task = input.taskId ? await fetchVideoTask(input.taskId) : null
  const providerFrame = task?.last_frame_url
  if (providerFrame) {
    try {
      const asset = await importPlaygroundAsset(providerFrame, 'image')
      return asset.url
    } catch {
      // The signed provider link still works for a while.
      return providerFrame
    }
  }
  // The authenticated same-origin proxy keeps the canvas readable.
  const src = input.taskId
    ? `/v1/videos/${input.taskId}/content`
    : (input.videoSrc ?? '')
  if (!src) throw new Error('No video source to read the last frame from')
  const blob = await captureVideoLastFrame(src)
  const file = new File(
    [blob],
    `last-frame-${input.taskId ?? Date.now()}.png`,
    {
      type: 'image/png',
    }
  )
  const asset = await uploadPlaygroundAsset(file, 'image', 'attachment')
  return asset.url
}
