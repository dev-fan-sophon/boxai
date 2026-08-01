import { and, eq, sql } from 'drizzle-orm'

import { db } from '../db'
import { conversations, messages, userMemories } from '../db/schema'
import { memoryReady, memorySettings } from './settings'
import type { MemorySettings } from './settings'

/**
 * Port of the gateway's playground memory maintenance: a rolling
 * per-conversation summary and cross-conversation user memories, produced
 * against the platform-paid endpoint in memorySettings. Runs in the
 * background after finalized turns are appended; failures only delay the
 * next attempt, they never surface to the user.
 */

const MAX_MEMORY_CONTENT_RUNES = 400
const MAX_SUMMARY_RUNES = 4000
const MAX_TURN_RUNES = 1200
const MAX_TRANSCRIPT_RUNES = 24000
const FAILURE_COOLDOWN_MS = 2 * 60_000

const MEMORY_CATEGORIES = new Set(['profile', 'preference', 'project', 'other'])

const EXTRACTION_PROMPT = `You maintain long-term memory about a user of an AI chat product.
From the conversation excerpt, extract only durable facts worth remembering across future conversations: stable profile facts (name, role, location, language), lasting preferences (tone, format, tools), and ongoing projects or goals. Ignore one-off requests, small talk, and anything about the current answer only.

You receive the existing memories as a numbered list. Reply with a single JSON object and nothing else:
{"add":[{"content":"...","category":"profile|preference|project|other"}],"update":[{"id":1,"content":"..."}],"delete":[2]}

Rules:
- Each memory is one short, self-contained sentence in the user's own language.
- Update or delete an existing memory when the excerpt contradicts or refines it; never store duplicates.
- When nothing durable appears, reply {"add":[],"update":[],"delete":[]}.`

const SUMMARY_PROMPT = `You compress chat history for an AI assistant. Merge the previous summary (if any) with the new conversation excerpt into one updated summary.
Keep: user goals and constraints, decisions made, key facts and numbers, unresolved questions, and the current state of any task. Drop pleasantries and repetition. Write compact prose or bullets in the conversation's main language, at most 300 words. Reply with the summary text only.`

type MemoryOps = {
  add?: Array<{ content?: string; category?: string }>
  update?: Array<{ id?: number; content?: string }>
  delete?: number[]
}

type MessageRow = typeof messages.$inferSelect
type ConversationRow = typeof conversations.$inferSelect

const inflight = new Set<number>()
let failureUntil = 0

function noteFailure() {
  failureUntil = Date.now() + FAILURE_COOLDOWN_MS
}

function truncateRunes(value: string, max: number): string {
  const runes = Array.from(value)
  return runes.length <= max ? value : runes.slice(0, max).join('')
}

function transcriptOf(rows: MessageRow[]): string {
  let out = ''
  for (const row of rows) {
    if (row.role !== 'user' && row.role !== 'assistant') {
      continue
    }
    const content = (row.content ?? '').trim()
    if (!content) {
      continue
    }
    const line = `${row.role}: ${truncateRunes(content, MAX_TURN_RUNES)}\n`
    if (Array.from(out).length + Array.from(line).length > MAX_TRANSCRIPT_RUNES) {
      break
    }
    out += line
  }
  return out.trim()
}

function messageClientKey(row: MessageRow): string {
  return row.clientKey || `srv-${row.id}`
}

// parseMemoryOps tolerates markdown fences and surrounding prose, but
// requires one JSON object with the add/update/delete contract.
export function parseMemoryOps(raw: string): MemoryOps {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('memory model returned no JSON object')
  }
  return JSON.parse(raw.slice(start, end + 1)) as MemoryOps
}

async function callMemoryModel(
  settings: MemorySettings,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  try {
    const endpoint = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        temperature: 0,
        max_tokens: 1500,
      }),
      signal: AbortSignal.timeout(settings.timeoutSeconds * 1000),
    })
    if (!response.ok) {
      throw new Error(`memory model returned status ${response.status}`)
    }
    const parsed = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = parsed.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new Error('memory model returned no choices')
    }
    return content
  } catch (error) {
    noteFailure()
    throw error
  }
}

async function maintainSummary(
  settings: MemorySettings,
  conv: ConversationRow,
  rows: MessageRow[]
): Promise<void> {
  if (rows.length < settings.summaryTriggerMessages) {
    return
  }
  const boundary = rows.length - settings.summaryKeepRecent
  if (boundary <= 0) {
    return
  }
  const tail = rows[boundary - 1]!
  const summarySeq = conv.summarySeq ?? -1
  if (tail.seq <= summarySeq) {
    return
  }
  const fresh = rows.slice(0, boundary).filter((row) => row.seq > summarySeq)
  const transcript = transcriptOf(fresh)
  if (!transcript) {
    return
  }
  const previous = (conv.summary ?? '').trim()
  const input = previous
    ? `Previous summary:\n${previous}\n\nNew conversation excerpt:\n${transcript}`
    : transcript
  const raw = await callMemoryModel(settings, SUMMARY_PROMPT, input)
  const summary = truncateRunes(raw.trim(), MAX_SUMMARY_RUNES)
  if (!summary) {
    throw new Error('summary model returned empty text')
  }
  // NULL-safe cursor guard, matching the gateway fix: a NULL summary_seq row
  // must accept its first summary.
  await db
    .update(conversations)
    .set({
      summary,
      summaryTailKey: messageClientKey(tail),
      summarySeq: tail.seq,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(
      and(
        eq(conversations.id, conv.id),
        eq(conversations.userId, conv.userId),
        sql`(${conversations.summarySeq} < ${tail.seq} OR ${conversations.summarySeq} IS NULL)`
      )
    )
}

async function maintainUserMemories(
  settings: MemorySettings,
  conv: ConversationRow,
  rows: MessageRow[]
): Promise<void> {
  const memorySeq = conv.memorySeq ?? -1
  const maxSeq = rows[rows.length - 1]!.seq
  if (maxSeq - memorySeq < settings.extractEveryMessages) {
    return
  }
  const advanceCursor = () =>
    db
      .update(conversations)
      .set({ memorySeq: maxSeq })
      .where(
        and(
          eq(conversations.id, conv.id),
          eq(conversations.userId, conv.userId),
          sql`(${conversations.memorySeq} < ${maxSeq} OR ${conversations.memorySeq} IS NULL)`
        )
      )

  const fresh = rows.filter((row) => row.seq > memorySeq)
  const transcript = transcriptOf(fresh)
  if (!transcript) {
    await advanceCursor()
    return
  }
  const existing = await db
    .select()
    .from(userMemories)
    .where(eq(userMemories.userId, conv.userId))
    .orderBy(userMemories.id)
  let input = 'Existing memories:\n'
  if (existing.length === 0) {
    input += '(none)\n'
  }
  for (const memory of existing) {
    input += `${memory.id}. [${memory.category}] ${memory.content}\n`
  }
  input += `\nConversation excerpt:\n${transcript}`
  const raw = await callMemoryModel(settings, EXTRACTION_PROMPT, input)
  const ops = parseMemoryOps(raw)
  await applyMemoryOps(conv.userId, conv.id, existing, ops, settings.maxMemories)
  await advanceCursor()
}

export async function applyMemoryOps(
  userId: number,
  conversationId: number,
  existing: Array<typeof userMemories.$inferSelect>,
  ops: MemoryOps,
  maxMemories: number
): Promise<void> {
  const owned = new Map(existing.map((memory) => [memory.id, memory]))
  const contents = new Set(existing.map((memory) => memory.content ?? ''))
  const now = Math.floor(Date.now() / 1000)

  for (const id of ops.delete ?? []) {
    const current = owned.get(id)
    if (!current) {
      continue
    }
    await db
      .delete(userMemories)
      .where(and(eq(userMemories.id, id), eq(userMemories.userId, userId)))
    contents.delete(current.content ?? '')
    owned.delete(id)
  }
  for (const update of ops.update ?? []) {
    const current = update.id ? owned.get(update.id) : undefined
    const content = truncateRunes(
      (update.content ?? '').trim(),
      MAX_MEMORY_CONTENT_RUNES
    )
    if (!current || !content || content === current.content) {
      continue
    }
    await db
      .update(userMemories)
      .set({ content, updatedAt: now })
      .where(
        and(eq(userMemories.id, current.id), eq(userMemories.userId, userId))
      )
    contents.delete(current.content ?? '')
    contents.add(content)
  }
  let remaining = owned.size
  for (const add of ops.add ?? []) {
    const content = truncateRunes(
      (add.content ?? '').trim(),
      MAX_MEMORY_CONTENT_RUNES
    )
    if (!content || contents.has(content) || remaining >= maxMemories) {
      continue
    }
    const category = (add.category ?? '').trim().toLowerCase()
    await db.insert(userMemories).values({
      userId,
      content,
      category: MEMORY_CATEGORIES.has(category) ? category : 'other',
      sourceConversationId: conversationId,
      createdAt: now,
      updatedAt: now,
    })
    contents.add(content)
    remaining++
  }
}

/**
 * Entry point, fire-and-forget from the append path and the agent loop's
 * onFinish. Serialized per conversation; endpoint failures put the whole
 * subsystem into a short cooldown, and cursors stay put so skipped work is
 * retried later.
 */
export async function runMemoryMaintenance(
  userId: number,
  conversationId: number,
  longMemory: boolean
): Promise<void> {
  const settings = memorySettings()
  if (!memoryReady(settings) || Date.now() < failureUntil) {
    return
  }
  if (inflight.has(conversationId)) {
    return
  }
  inflight.add(conversationId)
  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, userId)
        )
      )
    if (!conv || conv.kind === 'duo') {
      return
    }
    const rows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.userId, userId)
        )
      )
      .orderBy(messages.seq, messages.id)
    if (rows.length === 0) {
      return
    }
    if (settings.summaryEnabled) {
      await maintainSummary(settings, conv, rows).catch((error) =>
        console.error(
          `summary maintenance failed (conversation ${conversationId}):`,
          error
        )
      )
    }
    if (longMemory) {
      await maintainUserMemories(settings, conv, rows).catch((error) =>
        console.error(
          `memory extraction failed (user ${userId}, conversation ${conversationId}):`,
          error
        )
      )
    }
  } finally {
    inflight.delete(conversationId)
  }
}
