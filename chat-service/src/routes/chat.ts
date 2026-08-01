import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { UIMessage } from 'ai'

import { sessionAuth } from '../auth'
import type { AuthEnv } from '../auth'
import { assembleContext } from '../context/assemble'
import { db } from '../db'
import { appendMessage } from '../db/append'
import { conversations } from '../db/schema'
import { encodeLegacyToolJson } from '../db/tool-json'
import { runAgent } from '../engine/run-agent'
import { truncateRunes } from '../http'
import { runMemoryMaintenance } from '../memory/maintenance'
import { buildTools } from '../tools'

const chatRequestSchema = z.object({
  conversationId: z.number().int().positive().optional(),
  model: z.string().min(1).max(191),
  group: z.string().max(50).optional(),
  system: z.string().max(20_000).optional(),
  longMemory: z.boolean().optional(),
  assetIds: z.array(z.number().int().positive()).max(8).optional(),
  source: z.enum(['web', 'desktop']).optional(),
  message: z.unknown(),
})

type UIMessagePart = { type: string; text?: string }

function messageText(message: UIMessage): string {
  const parts = (message.parts ?? []) as UIMessagePart[]
  return parts
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text)
    .join('\n')
}

export const chatRoute = new Hono<AuthEnv>()

chatRoute.post('/', sessionAuth, async (c) => {
  const parsed = chatRequestSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ success: false, message: 'invalid chat request' }, 400)
  }
  const user = c.get('user')
  const { model, group, system, conversationId, assetIds, source } = parsed.data
  const longMemory = parsed.data.longMemory ?? false
  const incoming = parsed.data.message as UIMessage
  const userText = messageText(incoming)
  if (!userText.trim()) {
    return c.json({ success: false, message: 'message text is required' }, 400)
  }

  // Resolve or create the conversation; the server owns history from here on.
  let conv: typeof conversations.$inferSelect | undefined
  const now = Math.floor(Date.now() / 1000)
  if (conversationId) {
    ;[conv] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, user.id)
        )
      )
    if (!conv) {
      return c.json({ success: false, message: 'conversation not found' }, 404)
    }
  } else {
    ;[conv] = await db
      .insert(conversations)
      .values({
        userId: user.id,
        title: truncateRunes(userText.trim() || 'New chat', 200),
        model,
        group: group ?? '',
        kind: 'chat',
        source: source ?? 'web',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    if (!conv) {
      return c.json({ success: false, message: 'could not create conversation' }, 500)
    }
  }
  const conversation = conv

  // Context is assembled before the new turn is persisted so the incoming
  // message is not duplicated into the history window.
  const context = await assembleContext(conversation, { longMemory })

  await appendMessage(conversation.id, user.id, {
    role: 'user',
    content: userText,
    model,
    clientKey: incoming.id,
    source: source ?? 'web',
  })

  const result = await runAgent({
    userId: user.id,
    modelId: model,
    system,
    messages: [incoming],
    contextMessages: context,
    tools: buildTools({
      userId: user.id,
      group: group || user.group,
      modelId: model,
      conversationId: conversation.id,
      assetIds,
    }),
    abortSignal: c.req.raw.signal,
  })

  const response = result.toUIMessageStreamResponse({
    originalMessages: [incoming],
    // The response message id doubles as the persisted client_key; without it
    // the assistant row would sync back to clients under a different key and
    // duplicate the turn.
    generateMessageId: () => crypto.randomUUID(),
    onEnd: async ({ responseMessage, isAborted }) => {
      const text = messageText(responseMessage)
      const parts = responseMessage.parts ?? []
      const toolJson = encodeLegacyToolJson(parts)
      if (!text.trim() && !toolJson) {
        return
      }
      await appendMessage(conversation.id, user.id, {
        role: 'assistant',
        content: text,
        model,
        toolJson,
        clientKey: responseMessage.id,
        source: source ?? 'web',
      }).catch((error) =>
        console.error(
          `failed to persist assistant turn (conversation ${conversation.id}):`,
          error
        )
      )
      if (!isAborted) {
        void runMemoryMaintenance(user.id, conversation.id, longMemory)
      }
    },
  })
  response.headers.set('X-Conversation-Id', String(conversation.id))
  return response
})
