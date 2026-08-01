import type { UIMessage } from 'ai'
import { and, asc, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { sessionAuth } from '../auth'
import type { AuthEnv } from '../auth'
import { db } from '../db'
import {
  AGENT_RUN_LEASE_SECONDS,
  activateMessageRevision,
  AgentConflictError,
  requestAgentRunStop,
  stopAgentRun,
  deleteAgentMessage,
  editAgentMessage,
} from '../db/agent-history'
import {
  agentRuns,
  conversations,
  messageRevisions,
  messages,
} from '../db/schema'
import { abortActiveRun } from '../engine/active-runs'
import { fail, ok, truncateRunes } from '../http'
import { runMemoryMaintenance } from '../memory/maintenance'
import { canonicalizeUserMessage } from '../messages/content'

/**
 * Wire parity with the gateway's playground conversation endpoints: the
 * frontend reads snake_case fields straight off these payloads, so the DTO
 * mappers below mirror the Go struct json tags (including omitting the
 * internal summary_seq/memory_seq cursors, which are json:"-").
 */

type ConversationRow = typeof conversations.$inferSelect
type MessageRow = typeof messages.$inferSelect
type RevisionRow = typeof messageRevisions.$inferSelect

const SINCE_LIMIT = 200
const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function conversationDTO(row: ConversationRow) {
  const hasLiveRun =
    Boolean(row.activeRunId) &&
    Number(row.activeRunStartedAt ?? 0) > nowSeconds() - AGENT_RUN_LEASE_SECONDS
  return {
    id: row.id,
    user_id: row.userId,
    title: row.title ?? '',
    model: row.model ?? '',
    group: row.group ?? '',
    kind: row.kind ?? '',
    meta_json: row.metaJson ?? '',
    pinned: row.pinned ?? false,
    source: row.source ?? '',
    summary: row.summary ?? '',
    summary_tail_key: row.summaryTailKey ?? '',
    revision: Number(row.revision ?? 0),
    active_run_id: hasLiveRun ? (row.activeRunId ?? '') : '',
    active_run_started_at: hasLiveRun ? Number(row.activeRunStartedAt ?? 0) : 0,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

function revisionDTO(row: RevisionRow) {
  return {
    revision: row.revision,
    content: row.content ?? '',
    content_json: row.contentJson ?? '',
    model: row.model ?? '',
    tool_json: row.toolJson ?? '',
    status: row.status || 'complete',
    created_at: row.createdAt,
  }
}

function messageDTO(row: MessageRow, revisions?: RevisionRow[]) {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    user_id: row.userId,
    parent_message_id: row.parentMessageId ?? 0,
    role: row.role,
    content: row.content ?? '',
    content_json: row.contentJson ?? '',
    model: row.model ?? '',
    tool_json: row.toolJson ?? '',
    client_key: row.clientKey ?? '',
    source: row.source ?? '',
    status: row.status || 'complete',
    active_revision: row.activeRevision || 1,
    revision_count: revisions?.length || 1,
    ...(revisions ? { revisions: revisions.map(revisionDTO) } : {}),
    seq: row.seq,
    created_at: row.createdAt,
    updated_at: row.updatedAt || row.createdAt,
  }
}

function mutationFailure(c: Parameters<typeof fail>[0], error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof AgentConflictError) {
    return c.json({ success: false, message }, 409)
  }
  if (message.includes('not found')) {
    return c.json({ success: false, message }, 404)
  }
  return c.json({ success: false, message }, 400)
}

async function readJson(c: { req: { json: () => Promise<unknown> } }) {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {}
  } catch {
    return null
  }
}

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10)
  return Number.isNaN(id) ? null : id
}

function rawJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return JSON.stringify(value)
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/** Mirrors the Go handler's meta_json guard: valid JSON, at most 20k bytes. */
function normalizeMetaJson(value: unknown): {
  meta: string | null
  error?: string
} {
  const raw = rawJson(value)
  if (raw === null) return { meta: null }
  if (byteLength(raw) > 20_000)
    return { meta: null, error: 'meta_json too large' }
  return { meta: raw }
}

function normalizeSource(value: unknown): string {
  const source = typeof value === 'string' ? value.trim() : ''
  return source === 'web' || source === 'desktop' ? source : ''
}

type MessageInsert = {
  role: string
  content: string
  contentJson: string
  model: string
  toolJson: string
  clientKey: string
  source: string
  createdAt: number
}

function validateMessages(
  inputs: unknown[]
): { msgs: MessageInsert[]; invalid: '' } | { msgs: null; invalid: string } {
  const msgs: MessageInsert[] = []
  for (const item of inputs) {
    if (!item || typeof item !== 'object') continue
    const m = item as Record<string, unknown>
    const role = typeof m.role === 'string' ? m.role.trim() : ''
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue

    // longtext column: cap at 200k runes (not MySQL 64KB TEXT)
    const content = truncateRunes(
      typeof m.content === 'string' ? m.content : '',
      200_000
    )

    let contentJson = ''
    const rawContentJson = rawJson(m.content_json)
    if (rawContentJson !== null) {
      if (byteLength(rawContentJson) > 400_000)
        return { msgs: null, invalid: 'content_json too large' }
      const parts = m.content_json
      if (
        !Array.isArray(parts) ||
        parts.some(
          (p) => p !== null && (typeof p !== 'object' || Array.isArray(p))
        )
      ) {
        return { msgs: null, invalid: 'invalid content_json' }
      }
      contentJson = rawContentJson
    }

    let toolJson = ''
    const rawToolJson = rawJson(m.tool_json)
    if (rawToolJson !== null) {
      if (byteLength(rawToolJson) > 100_000)
        return { msgs: null, invalid: 'tool_json too large' }
      toolJson = rawToolJson
    }

    let clientKey = typeof m.client_key === 'string' ? m.client_key.trim() : ''
    if (clientKey.length > 64) clientKey = clientKey.slice(0, 64)

    const createdAt =
      typeof m.created_at === 'number' && m.created_at > 0
        ? Math.floor(m.created_at)
        : 0

    msgs.push({
      role,
      content,
      contentJson,
      model: truncateRunes(
        typeof m.model === 'string' ? m.model.trim() : '',
        191
      ),
      toolJson,
      clientKey,
      source: normalizeSource(m.source),
      createdAt,
    })
  }
  return { msgs, invalid: '' }
}

/** Names an untitled thread after its first user turn, as the gateway does. */
async function autoTitleConversation(
  id: number,
  userId: number,
  msgs: MessageInsert[]
) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1)
  if (!conv) return
  const title = conv.title ?? ''
  if (title !== '' && title !== 'New chat') return
  for (const m of msgs) {
    if (m.role === 'user' && m.content.trim() !== '') {
      await db
        .update(conversations)
        .set({
          title: truncateRunes(m.content.trim(), 48),
          updatedAt: nowSeconds(),
        })
        .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      return
    }
  }
}

export const conversationsRoute = new Hono<AuthEnv>()

conversationsRoute.use('*', sessionAuth)

conversationsRoute.get('/', async (c) => {
  const userId = c.get('user').id
  const sinceStr = c.req.query('since')
  if (sinceStr) {
    const since = Number.parseInt(sinceStr, 10)
    if (Number.isNaN(since) || since < 0) return fail(c, 'invalid since')
    const items = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, userId),
          gte(conversations.updatedAt, since)
        )
      )
      .orderBy(asc(conversations.updatedAt), asc(conversations.id))
      .limit(SINCE_LIMIT)
    return ok(c, {
      items: items.map(conversationDTO),
      has_more: items.length === SINCE_LIMIT,
    })
  }

  let page = Number.parseInt(c.req.query('p') ?? '', 10)
  if (Number.isNaN(page) || page < 1) page = 1
  let pageSize = Number.parseInt(c.req.query('page_size') ?? '', 10)
  if (Number.isNaN(pageSize) || pageSize === 0) {
    pageSize = Number.parseInt(c.req.query('ps') ?? '', 10)
    if (Number.isNaN(pageSize) || pageSize === 0) {
      pageSize = Number.parseInt(c.req.query('size') ?? '', 10)
    }
    if (Number.isNaN(pageSize) || pageSize === 0) pageSize = DEFAULT_PAGE_SIZE
  }
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE

  const [countRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(conversations)
    .where(eq(conversations.userId, userId))
  const items = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.pinned), desc(conversations.updatedAt))
    .offset((page - 1) * pageSize)
    .limit(pageSize)

  return ok(c, {
    page,
    page_size: pageSize,
    total: Number(countRow?.total ?? 0),
    items: items.map(conversationDTO),
  })
})

conversationsRoute.post('/', async (c) => {
  const userId = c.get('user').id
  const body = await readJson(c)
  if (!body) return fail(c, 'invalid request body')

  let title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title === '') title = 'New chat'
  title = truncateRunes(title, 200)

  let kind = typeof body.kind === 'string' ? body.kind.trim() : ''
  if (kind === '') kind = 'chat'
  if (kind !== 'chat' && kind !== 'duo') return fail(c, 'invalid kind')

  const { meta, error } = normalizeMetaJson(body.meta_json)
  if (error) return fail(c, error)

  const now = nowSeconds()
  const [row] = await db
    .insert(conversations)
    .values({
      userId,
      title,
      model: typeof body.model === 'string' ? body.model : '',
      group: typeof body.group === 'string' ? body.group : '',
      kind,
      metaJson: meta ?? '',
      pinned: false,
      source: normalizeSource(body.source),
      summary: '',
      summaryTailKey: '',
      summarySeq: 0,
      memorySeq: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  if (!row) return fail(c, 'failed to create conversation')
  return ok(c, conversationDTO(row))
})

conversationsRoute.get('/:id', async (c) => {
  const userId = c.get('user').id
  const id = parseId(c.req.param('id'))
  if (id === null) return fail(c, 'invalid id')
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1)
  if (!conv) return fail(c, 'conversation not found')
  const items = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, id), eq(messages.userId, userId)))
    .orderBy(asc(messages.seq), asc(messages.id))
  const revisions = await db
    .select()
    .from(messageRevisions)
    .where(
      and(
        eq(messageRevisions.conversationId, id),
        eq(messageRevisions.userId, userId)
      )
    )
    .orderBy(asc(messageRevisions.messageId), asc(messageRevisions.revision))
  const revisionsByMessage = new Map<number, RevisionRow[]>()
  for (const revision of revisions) {
    const existing = revisionsByMessage.get(revision.messageId) ?? []
    existing.push(revision)
    revisionsByMessage.set(revision.messageId, existing)
  }
  return ok(c, {
    conversation: conversationDTO(conv),
    messages: items.map((item) =>
      messageDTO(item, revisionsByMessage.get(item.id) ?? [])
    ),
  })
})

conversationsRoute.put('/:id', async (c) => {
  const userId = c.get('user').id
  const id = parseId(c.req.param('id'))
  if (id === null) return fail(c, 'invalid id')
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1)
  if (!conv) return fail(c, 'conversation not found')

  const body = await readJson(c)
  if (!body) return fail(c, 'invalid request body')

  const updates: Partial<typeof conversations.$inferInsert> = {}
  if (typeof body.pinned === 'boolean') updates.pinned = body.pinned
  if (typeof body.title === 'string')
    updates.title = truncateRunes(body.title.trim(), 200)
  if (typeof body.model === 'string') updates.model = body.model
  if (typeof body.group === 'string') updates.group = body.group
  if (typeof body.kind === 'string') {
    const kind = body.kind.trim()
    if (kind !== '' && kind !== 'chat' && kind !== 'duo')
      return fail(c, 'invalid kind')
    updates.kind = kind === '' ? 'chat' : kind
  }
  const { meta, error } = normalizeMetaJson(body.meta_json)
  if (error) return fail(c, error)
  if (meta !== null) updates.metaJson = meta

  updates.updatedAt = nowSeconds()
  const [row] = await db
    .update(conversations)
    .set(updates)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning()
  return ok(c, conversationDTO(row ?? { ...conv, ...updates }))
})

conversationsRoute.delete('/:id', async (c) => {
  const userId = c.get('user').id
  const id = parseId(c.req.param('id'))
  if (id === null) return fail(c, 'invalid id')
  const deleted = await db
    .transaction(async (tx) => {
      const [conv] = await tx
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
        .for('update')
      if (!conv) return null
      if (
        conv.activeRunId &&
        Number(conv.activeRunStartedAt ?? 0) >
          nowSeconds() - AGENT_RUN_LEASE_SECONDS
      ) {
        throw new AgentConflictError(
          'stop the active response before deleting this conversation'
        )
      }
      await tx
        .delete(messageRevisions)
        .where(
          and(
            eq(messageRevisions.conversationId, id),
            eq(messageRevisions.userId, userId)
          )
        )
      await tx
        .delete(agentRuns)
        .where(
          and(eq(agentRuns.conversationId, id), eq(agentRuns.userId, userId))
        )
      await tx
        .delete(messages)
        .where(
          and(eq(messages.conversationId, id), eq(messages.userId, userId))
        )
      return await tx
        .delete(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
        .returning({ id: conversations.id })
    })
    .catch((error) => error)
  if (deleted instanceof Error) return mutationFailure(c, deleted)
  if (!deleted || deleted.length === 0) return fail(c, 'conversation not found')
  return ok(c, null)
})

conversationsRoute.put('/:id/messages', async (c) => {
  const userId = c.get('user').id
  const id = parseId(c.req.param('id'))
  if (id === null) return fail(c, 'invalid id')
  const body = await readJson(c)
  if (!body) return fail(c, 'invalid request body')
  const inputs = Array.isArray(body.messages) ? body.messages : []
  if (inputs.length > 500) return fail(c, 'too many messages (max 500)')
  const result = validateMessages(inputs)
  if (result.msgs === null) return fail(c, result.invalid)
  const msgs = result.msgs

  const replaced = await db
    .transaction(async (tx) => {
      const [conv] = await tx
        .select({
          id: conversations.id,
          revision: conversations.revision,
          activeRunId: conversations.activeRunId,
        })
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
        .for('update')
      if (!conv) return false
      if (Number(conv.revision ?? 0) > 0 || conv.activeRunId) {
        throw new AgentConflictError('conversation is managed by agent chat')
      }
      await tx
        .delete(messages)
        .where(
          and(eq(messages.conversationId, id), eq(messages.userId, userId))
        )
      const now = nowSeconds()
      if (msgs.length > 0) {
        await tx.insert(messages).values(
          msgs.map((m, index) => ({
            conversationId: id,
            userId,
            role: m.role,
            content: m.content,
            contentJson: m.contentJson,
            model: m.model,
            toolJson: m.toolJson,
            clientKey: m.clientKey,
            source: m.source,
            seq: index,
            createdAt: m.createdAt === 0 ? now : m.createdAt,
          }))
        )
      }
      // The replace renumbered seq and recreated rows, so the rolling summary and
      // its cursors no longer describe this thread.
      await tx
        .update(conversations)
        .set({
          updatedAt: now,
          summary: '',
          summaryTailKey: '',
          summarySeq: 0,
          memorySeq: 0,
        })
        .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      return true
    })
    .catch((error) => error)
  if (replaced instanceof Error) return mutationFailure(c, replaced)
  if (!replaced) return fail(c, 'conversation not found')

  await autoTitleConversation(id, userId, msgs)
  return ok(c, { count: msgs.length })
})

conversationsRoute.post('/:id/messages', async (c) => {
  const userId = c.get('user').id
  const id = parseId(c.req.param('id'))
  if (id === null) return fail(c, 'invalid id')
  const body = await readJson(c)
  if (!body) return fail(c, 'invalid request body')
  const inputs = Array.isArray(body.messages) ? body.messages : []
  if (inputs.length === 0) return fail(c, 'messages is required')
  if (inputs.length > 40)
    return fail(c, 'too many messages (max 40 per append)')
  const result = validateMessages(inputs)
  if (result.msgs === null) return fail(c, result.invalid)
  const msgs = result.msgs

  const appended = await db
    .transaction(async (tx) => {
      // Lock the thread row to serialize seq assignment across clients.
      const [conv] = await tx
        .select({
          id: conversations.id,
          revision: conversations.revision,
          activeRunId: conversations.activeRunId,
        })
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
        .limit(1)
        .for('update')
      if (!conv) return null
      if (Number(conv.revision ?? 0) > 0 || conv.activeRunId) {
        throw new AgentConflictError('conversation is managed by agent chat')
      }

      const keys = msgs.map((m) => m.clientKey).filter((k) => k !== '')
      const existing = new Set<string>()
      if (keys.length > 0) {
        const found = await tx
          .select({ clientKey: messages.clientKey })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, id),
              inArray(messages.clientKey, keys)
            )
          )
        for (const row of found) {
          if (row.clientKey) existing.add(row.clientKey)
        }
      }

      const [seqRow] = await tx
        .select({ maxSeq: sql<number>`COALESCE(MAX(${messages.seq}), -1)` })
        .from(messages)
        .where(eq(messages.conversationId, id))
      let maxSeq = Number(seqRow?.maxSeq ?? -1)

      const now = nowSeconds()
      const pending: (typeof messages.$inferInsert)[] = []
      for (const m of msgs) {
        if (m.clientKey !== '' && existing.has(m.clientKey)) continue
        maxSeq++
        pending.push({
          conversationId: id,
          userId,
          role: m.role,
          content: m.content,
          contentJson: m.contentJson,
          model: m.model,
          toolJson: m.toolJson,
          clientKey: m.clientKey,
          source: m.source,
          seq: maxSeq,
          createdAt: m.createdAt === 0 ? now : m.createdAt,
        })
        if (m.clientKey !== '') existing.add(m.clientKey)
      }

      const inserted =
        pending.length > 0
          ? await tx.insert(messages).values(pending).returning()
          : []
      await tx
        .update(conversations)
        .set({ updatedAt: now })
        .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
      return inserted
    })
    .catch((error) => error)
  if (appended instanceof Error) return mutationFailure(c, appended)
  if (appended === null) return fail(c, 'conversation not found')

  await autoTitleConversation(id, userId, msgs)
  // Same trigger the gateway had after a successful cloud-sync append:
  // background summary/memory maintenance, never blocking the response.
  if (appended.length > 0) {
    void runMemoryMaintenance(userId, id, body.long_memory === true)
  }
  return ok(c, {
    messages: appended.map((message: MessageRow) => messageDTO(message)),
    appended: appended.length,
    skipped: msgs.length - appended.length,
  })
})

conversationsRoute.get('/:id/messages', async (c) => {
  const userId = c.get('user').id
  const id = parseId(c.req.param('id'))
  if (id === null) return fail(c, 'invalid id')
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1)
  if (!conv) return fail(c, 'conversation not found')

  let sinceId = Number.parseInt(c.req.query('since_id') ?? '', 10)
  if (Number.isNaN(sinceId) || sinceId < 0) sinceId = 0
  let limit = Number.parseInt(c.req.query('limit') ?? '', 10)
  if (Number.isNaN(limit) || limit <= 0 || limit > 200) limit = 200

  const items = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, id),
        eq(messages.userId, userId),
        gt(messages.id, sinceId)
      )
    )
    .orderBy(asc(messages.id))
    .limit(limit)
  return ok(c, {
    messages: items.map((message) => messageDTO(message)),
    has_more: items.length === limit,
  })
})

conversationsRoute.patch('/:id/messages/:key', async (c) => {
  const userId = c.get('user').id
  const id = parseId(c.req.param('id'))
  if (id === null) return fail(c, 'invalid id')
  const body = await readJson(c)
  if (!body) return fail(c, 'invalid request body')
  if (
    typeof body.expected_revision !== 'number' ||
    !Number.isInteger(body.expected_revision) ||
    body.expected_revision < 0
  ) {
    return fail(c, 'expected_revision is required')
  }
  try {
    const content = truncateRunes(
      typeof body.content === 'string' ? body.content : '',
      200_000
    )
    const parts = Array.isArray(body.parts)
      ? body.parts
      : [{ type: 'text', text: content }]
    const canonical = await canonicalizeUserMessage(
      userId,
      {
        id: c.req.param('key'),
        role: 'user',
        parts,
      } as UIMessage,
      c.get('user').group,
      c.req.raw.signal
    )
    const revision = await editAgentMessage(
      id,
      userId,
      c.req.param('key'),
      {
        content: canonical.content,
        contentJson: canonical.contentJson,
        status: 'complete',
      },
      body.expected_revision
    )
    return ok(c, { revision })
  } catch (error) {
    return mutationFailure(c, error)
  }
})

conversationsRoute.delete('/:id/messages/:key', async (c) => {
  const userId = c.get('user').id
  const id = parseId(c.req.param('id'))
  if (id === null) return fail(c, 'invalid id')
  const body = await readJson(c)
  if (!body) return fail(c, 'invalid request body')
  if (
    typeof body.expected_revision !== 'number' ||
    !Number.isInteger(body.expected_revision) ||
    body.expected_revision < 0
  ) {
    return fail(c, 'expected_revision is required')
  }
  try {
    const revision = await deleteAgentMessage(
      id,
      userId,
      c.req.param('key'),
      body.expected_revision
    )
    return ok(c, { revision })
  } catch (error) {
    return mutationFailure(c, error)
  }
})

conversationsRoute.post(
  '/:id/messages/:key/revisions/:revision/activate',
  async (c) => {
    const userId = c.get('user').id
    const id = parseId(c.req.param('id'))
    const revisionNumber = parseId(c.req.param('revision'))
    if (id === null || revisionNumber === null || revisionNumber <= 0) {
      return fail(c, 'invalid revision')
    }
    const body = await readJson(c)
    if (!body) return fail(c, 'invalid request body')
    if (
      typeof body.expected_revision !== 'number' ||
      !Number.isInteger(body.expected_revision) ||
      body.expected_revision < 0
    ) {
      return fail(c, 'expected_revision is required')
    }
    try {
      const revision = await activateMessageRevision(
        id,
        userId,
        c.req.param('key'),
        revisionNumber,
        body.expected_revision
      )
      return ok(c, { revision })
    } catch (error) {
      return mutationFailure(c, error)
    }
  }
)

conversationsRoute.post('/:id/runs/:runId/cancel', async (c) => {
  const userId = c.get('user').id
  const id = parseId(c.req.param('id'))
  if (id === null) return fail(c, 'invalid id')
  const runId = c.req.param('runId')
  const requested = await requestAgentRunStop(runId, userId, id)
  const aborted = await abortActiveRun(runId, userId, id)
  const stopped = aborted ? false : await stopAgentRun(runId, userId, id)
  return ok(c, { stopped: requested || aborted || stopped })
})
