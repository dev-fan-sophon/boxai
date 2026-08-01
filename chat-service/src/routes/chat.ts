import { Hono } from 'hono'
import { z } from 'zod'
import type { UIMessage } from 'ai'

import { sessionAuth } from '../auth'
import type { AuthEnv } from '../auth'
import { runAgent } from '../engine/run-agent'
import { buildTools } from '../tools'

const chatRequestSchema = z.object({
  model: z.string().min(1).max(191),
  conversationId: z.number().int().positive().optional(),
  system: z.string().max(20_000).optional(),
  assetIds: z.array(z.number().int().positive()).max(8).optional(),
  messages: z.array(z.unknown()).min(1).max(400),
})

export const chatRoute = new Hono<AuthEnv>()

chatRoute.post('/', sessionAuth, async (c) => {
  const parsed = chatRequestSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ success: false, message: 'invalid chat request' }, 400)
  }
  const user = c.get('user')
  const { model, system, conversationId, assetIds } = parsed.data
  const messages = parsed.data.messages as UIMessage[]

  const result = await runAgent({
    userId: user.id,
    modelId: model,
    system,
    messages,
    tools: buildTools({
      userId: user.id,
      group: user.group,
      modelId: model,
      conversationId,
      assetIds,
    }),
    abortSignal: c.req.raw.signal,
  })
  return result.toUIMessageStreamResponse()
})
