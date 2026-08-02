import type { ModelMessage } from 'ai'
import { and, desc, eq, gt } from 'drizzle-orm'

import { db } from '../db'
import { messages, userMemories } from '../db/schema'
import type { conversations } from '../db/schema'
import {
  createAttachmentContextBudget,
  storedUserMessageToModelMessage,
} from '../messages/content'
import type { CanonicalUserMessage } from '../messages/content'

type ConversationRow = typeof conversations.$inferSelect

/**
 * Server-side context assembly, the single place that decides what the model
 * sees: long-term memories, the rolling summary, and the verbatim window of
 * turns after the summary tail. This replaces the browser-side payload
 * builder; clients send only the new turn.
 */

const MAX_HISTORY_TURNS = 60

export type ContextAssemblyTiming = {
  memoryQueryMs: number
  historyQueryMs: number
  hydrationMs: number
}

export async function assembleContext(
  conv: ConversationRow,
  options: {
    longMemory: boolean
    carryHistory: boolean
    group: string
    signal?: AbortSignal
    excludeMessageId?: number
    focusMessageId: number
    preparedFocus?: CanonicalUserMessage
    onTiming?: (timing: ContextAssemblyTiming) => void
  }
): Promise<ModelMessage[]> {
  const context: ModelMessage[] = []
  const summary = options.carryHistory ? (conv.summary ?? '').trim() : ''
  const summarySeq = conv.summarySeq ?? -1
  let memoryQueryMs = 0
  const memoryStartedAt = performance.now()
  const memoriesPromise = options.longMemory
    ? db
        .select()
        .from(userMemories)
        .where(eq(userMemories.userId, conv.userId))
        .orderBy(userMemories.id)
        .then((rows) => {
          memoryQueryMs = performance.now() - memoryStartedAt
          return rows
        })
    : Promise.resolve([])

  const historyConditions = [
    eq(messages.conversationId, conv.id),
    eq(messages.userId, conv.userId),
  ]
  if (summary) historyConditions.push(gt(messages.seq, summarySeq))
  // Keep filtering of excluded, empty, and non-chat rows below the LIMIT. Those
  // rows counted toward the old in-memory 60-row window, so filtering them in
  // SQL would silently pull additional older turns into the model context.
  const historyStartedAt = performance.now()
  let historyQueryMs = 0
  const rowsPromise = (options.carryHistory
    ? db
        .select()
        .from(messages)
        .where(and(...historyConditions))
        .orderBy(desc(messages.seq), desc(messages.id))
        .limit(MAX_HISTORY_TURNS)
    : db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conv.id),
            eq(messages.userId, conv.userId),
            eq(messages.id, options.focusMessageId)
          )
        )
        .limit(1)
  ).then((rows) => {
    historyQueryMs = performance.now() - historyStartedAt
    if (options.carryHistory) rows.reverse()
    return rows
  })
  const [memories, verbatim] = await Promise.all([memoriesPromise, rowsPromise])

  if (memories.length > 0) {
    const lines = memories.map((memory) => `- ${memory.content}`).join('\n')
    context.push({
      role: 'system',
      content: `Known facts about the user (long-term memory):\n${lines}`,
    })
  }
  if (summary) {
    context.push({
      role: 'system',
      content: `Summary of the earlier conversation:\n${summary}`,
    })
  }

  const attachmentBudget = createAttachmentContextBudget()
  const hydrationStartedAt = performance.now()
  for (const row of verbatim) {
    if (row.id === options.excludeMessageId) continue
    if (row.role !== 'user' && row.role !== 'assistant') {
      continue
    }
    const content = (row.content ?? '').trim()
    if (!content && !row.contentJson) {
      continue
    }
    if (row.role === 'user' && row.contentJson) {
      const prepared = options.preparedFocus
      const usage = prepared?.attachmentContext
      const canReusePrepared =
        row.id === options.focusMessageId &&
        row.contentJson === prepared?.contentJson &&
        usage !== undefined &&
        usage.imageBytes <= attachmentBudget.imageBytes &&
        usage.imageCount <= attachmentBudget.imageCount &&
        usage.documentRunes <= attachmentBudget.documentRunes &&
        usage.assetIds.every((assetId) => !attachmentBudget.cache.has(assetId))
      if (canReusePrepared) {
        attachmentBudget.imageBytes -= usage.imageBytes
        attachmentBudget.imageCount -= usage.imageCount
        attachmentBudget.documentRunes -= usage.documentRunes
        context.push(prepared.modelMessage)
        continue
      }
      try {
        context.push(
          await storedUserMessageToModelMessage(
            conv.userId,
            content,
            row.contentJson,
            options.group,
            options.signal,
            attachmentBudget
          )
        )
        continue
      } catch (error) {
        console.warn(
          `could not hydrate historical attachments (message ${row.id}):`,
          error
        )
      }
    }
    if (content) context.push({ role: row.role, content })
  }
  options.onTiming?.({
    memoryQueryMs,
    historyQueryMs,
    hydrationMs: performance.now() - hydrationStartedAt,
  })
  return context
}
