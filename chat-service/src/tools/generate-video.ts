import { tool } from 'ai'
import { z } from 'zod'

import { config } from '../config'
import { billedRelayFetch, taskStatus } from '../gateway/client'
import type { ToolContext } from './index'
import { resolveToolModels } from './tool-models'

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 6 * 60_000

export function waitForVideoPoll(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason ?? new Error('video generation was cancelled'))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, POLL_INTERVAL_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

export function generateVideoTool(context: ToolContext) {
  return tool({
    description:
      'Generate a short video from a text prompt. Video generation takes a ' +
      'few minutes; the tool waits for the result.',
    inputSchema: z.object({
      prompt: z
        .string()
        .min(1)
        .max(4000)
        .describe('A detailed description of the video to generate'),
    }),
    execute: async ({ prompt }, options) => {
      const signal = options?.abortSignal
      const models = await resolveToolModels(context, signal)
      if (!models.video_model) {
        throw new Error('no video model is available for this group')
      }
      const response = await billedRelayFetch(context.userId, context.group)(
        `${config.gatewayBaseUrl}/pg/video/generations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: models.video_model,
            group: context.group,
            prompt,
          }),
          signal,
        }
      )
      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(failure.error?.message || 'video generation failed')
      }
      const body = (await response.json()) as {
        data?: { task_id?: string; id?: string }
        task_id?: string
        id?: string
      }
      const taskId = String(
        body.data?.task_id ?? body.data?.id ?? body.task_id ?? body.id ?? ''
      )
      if (!taskId) {
        throw new Error('video generation returned no task')
      }

      const deadline = Date.now() + POLL_TIMEOUT_MS
      while (Date.now() < deadline) {
        await waitForVideoPoll(signal)
        const status = await taskStatus(context.userId, taskId, signal)
        if (status.status === 'SUCCESS' && status.video_url) {
          return {
            model: models.video_model,
            task_id: taskId,
            video_url: status.video_url,
          }
        }
        if (status.status === 'FAILURE') {
          throw new Error(status.fail_reason || 'video generation failed')
        }
      }
      throw new Error('video generation timed out')
    },
  })
}
