import { tool } from 'ai'
import { z } from 'zod'

import { config } from '../config'
import {
  billedRelayFetch,
  gatewayFailureMessage,
  importAsset,
  uploadAsset,
} from '../gateway/client'
import type { ToolContext } from './index'
import { resolveToolModels } from './tool-models'

type ImageGenerationItem = { url?: string; b64_json?: string }

export function generateImageTool(context: ToolContext) {
  return tool({
    description:
      'Generate an image from a text prompt. Use for drawings, photos, ' +
      'posters, logos, or any visual the user asks you to create.',
    inputSchema: z.object({
      prompt: z
        .string()
        .min(1)
        .max(4000)
        .describe('A detailed visual description of the image to generate'),
    }),
    execute: async ({ prompt }, options) => {
      const signal = options?.abortSignal
      const models = await resolveToolModels(context, signal)
      if (!models.image_model) {
        throw new Error('no image model is available for this group')
      }
      const response = await billedRelayFetch(context.userId, context.group)(
        `${config.gatewayBaseUrl}/pg/images/generations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: models.image_model,
            group: context.group,
            prompt,
            n: 1,
          }),
          signal,
        }
      )
      if (!response.ok) {
        const failure = await response.json().catch(() => null)
        throw new Error(
          gatewayFailureMessage(failure) || 'image generation failed'
        )
      }
      const body = (await response.json()) as { data?: ImageGenerationItem[] }
      const items = body.data ?? []
      const assets = []
      for (const item of items) {
        if (item.url && /^https?:\/\//.test(item.url)) {
          assets.push(
            await importAsset(
              context.userId,
              {
                source_url: item.url,
                kind: 'image',
              },
              signal
            )
          )
        } else if (item.b64_json) {
          const bytes = Uint8Array.from(atob(item.b64_json), (ch) =>
            ch.charCodeAt(0)
          )
          assets.push(
            await uploadAsset(
              context.userId,
              new Blob([bytes], { type: 'image/png' }),
              `generated-${Date.now()}.png`,
              signal
            )
          )
        }
      }
      if (assets.length === 0) {
        throw new Error('image generation returned no image')
      }
      return {
        model: models.image_model,
        images: assets.map((asset) => ({ asset_id: asset.id, url: asset.url })),
      }
    },
  })
}
