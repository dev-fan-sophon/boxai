import { tool } from 'ai'
import { z } from 'zod'

import { config } from '../config'
import { billedRelayFetch, taskStatus } from '../gateway/client'
import { resolveToolModels } from './tool-models'
import type { ToolContext } from './index'

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 6 * 60_000

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
      const models = await resolveToolModels(context)
      if (!models.video_model) {
        throw new Error('no video model is available for this group')
      }
      const response = await billedRelayFetch(context.userId)(
        `${config.gatewayBaseUrl}/pg/video/generations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: models.video_model,
            group: context.group,
            prompt,
          }),
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
        if (options?.abortSignal?.aborted) {
          throw new Error('video generation was cancelled')
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        const status = await taskStatus(context.userId, taskId)
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
