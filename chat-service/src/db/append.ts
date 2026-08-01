import { and, eq, sql } from 'drizzle-orm'

import { db } from './index'
import { conversations, messages } from './schema'

export type AppendableMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
  contentJson?: string
  model?: string
  toolJson?: string
  clientKey?: string
  source?: string
}

/**
 * Appends one turn with the same semantics the gateway enforced: the
 * conversation row is locked to serialize seq assignment across writers, and
 * a client_key that already exists in the thread makes the append a no-op so
 * retries are safe. Returns the inserted row, or null when deduplicated.
 */
export async function appendMessage(
  conversationId: number,
  userId: number,
  message: AppendableMessage
) {
  return db.transaction(async (tx) => {
    const [conv] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, userId)
        )
      )
      .for('update')
    if (!conv) {
      throw new Error('conversation not found')
    }
    const clientKey = (message.clientKey ?? '').slice(0, 64)
    if (clientKey) {
      const [existing] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.clientKey, clientKey)
          )
        )
      if (existing) {
        return null
      }
    }
    const [row] = await tx
      .select({ maxSeq: sql<number>`COALESCE(MAX(${messages.seq}), -1)` })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
    const now = Math.floor(Date.now() / 1000)
    const [inserted] = await tx
      .insert(messages)
      .values({
        conversationId,
        userId,
        role: message.role,
        content: message.content,
        contentJson: message.contentJson ?? '',
        model: (message.model ?? '').slice(0, 191),
        toolJson: message.toolJson ?? '',
        clientKey,
        source: message.source ?? '',
        seq: (row?.maxSeq ?? -1) + 1,
        createdAt: now,
      })
      .returning()
    await tx
      .update(conversations)
      .set({ updatedAt: now })
      .where(eq(conversations.id, conversationId))
    return inserted ?? null
  })
}
