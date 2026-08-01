import { tool } from 'ai'
import { z } from 'zod'

import { config } from '../config'
import { billedRelayFetch, importAsset, uploadAsset } from '../gateway/client'
import { resolveToolModels } from './tool-models'
import type { ToolContext } from './index'

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
    execute: async ({ prompt }) => {
      const models = await resolveToolModels(context)
      if (!models.image_model) {
        throw new Error('no image model is available for this group')
      }
      const response = await billedRelayFetch(context.userId)(
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
        }
      )
      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(failure.error?.message || 'image generation failed')
      }
      const body = (await response.json()) as { data?: ImageGenerationItem[] }
      const items = body.data ?? []
      const assets = []
      for (const item of items) {
        if (item.url && /^https?:\/\//.test(item.url)) {
          assets.push(
            await importAsset(context.userId, {
              source_url: item.url,
              kind: 'image',
            })
          )
        } else if (item.b64_json) {
          const bytes = Uint8Array.from(atob(item.b64_json), (ch) =>
            ch.charCodeAt(0)
          )
          assets.push(
            await uploadAsset(
              context.userId,
              new Blob([bytes], { type: 'image/png' }),
              `generated-${Date.now()}.png`
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
