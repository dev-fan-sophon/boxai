import { and, eq } from 'drizzle-orm'
import type { ModelMessage } from 'ai'

import { db } from '../db'
import { messages, userMemories } from '../db/schema'
import type { conversations } from '../db/schema'

type ConversationRow = typeof conversations.$inferSelect

/**
 * Server-side context assembly, the single place that decides what the model
 * sees: long-term memories, the rolling summary, and the verbatim window of
 * turns after the summary tail. This replaces the browser-side payload
 * builder; clients send only the new turn.
 */

const MAX_HISTORY_TURNS = 60

export async function assembleContext(
  conv: ConversationRow,
  options: { longMemory: boolean }
): Promise<ModelMessage[]> {
  const context: ModelMessage[] = []

  if (options.longMemory) {
    const memories = await db
      .select()
      .from(userMemories)
      .where(eq(userMemories.userId, conv.userId))
      .orderBy(userMemories.id)
    if (memories.length > 0) {
      const lines = memories
        .map((memory) => `- ${memory.content}`)
        .join('\n')
      context.push({
        role: 'system',
        content: `Known facts about the user (long-term memory):\n${lines}`,
      })
    }
  }

  const summary = (conv.summary ?? '').trim()
  const summarySeq = conv.summarySeq ?? -1
  if (summary) {
    context.push({
      role: 'system',
      content: `Summary of the earlier conversation:\n${summary}`,
    })
  }

  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conv.id),
        eq(messages.userId, conv.userId)
      )
    )
    .orderBy(messages.seq, messages.id)

  // Turns already folded into the summary are dropped; without a summary the
  // window is simply the most recent turns.
  const verbatim = summary ? rows.filter((row) => row.seq > summarySeq) : rows
  for (const row of verbatim.slice(-MAX_HISTORY_TURNS)) {
    if (row.role !== 'user' && row.role !== 'assistant') {
      continue
    }
    const content = (row.content ?? '').trim()
    if (!content) {
      continue
    }
    context.push({ role: row.role, content })
  }
  return context
}
