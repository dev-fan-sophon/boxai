import { and, asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { sessionAuth } from '../auth'
import type { AuthEnv } from '../auth'
import { db } from '../db'
import { userMemories } from '../db/schema'
import { fail, ok, truncateRunes } from '../http'

const MAX_MEMORY_INPUT_RUNES = 400

/**
 * The gateway derived `enabled` from the admin-configured extraction endpoint
 * (system_setting playground_memory). This service has no access to that
 * setting store, so the same three-part readiness check is read from the
 * environment instead.
 */
function memoryExtractionReady(): boolean {
  return (
    process.env.PLAYGROUND_MEMORY_ENABLED === 'true' &&
    (process.env.PLAYGROUND_MEMORY_BASE_URL ?? '').trim() !== '' &&
    (process.env.PLAYGROUND_MEMORY_API_KEY ?? '').trim() !== '' &&
    (process.env.PLAYGROUND_MEMORY_MODEL ?? '').trim() !== ''
  )
}

type MemoryRow = typeof userMemories.$inferSelect

function toDTO(row: MemoryRow) {
  return {
    id: row.id,
    user_id: row.userId,
    content: row.content ?? '',
    category: row.category ?? '',
    source_conversation_id: row.sourceConversationId ?? 0,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

export const memoriesRoute = new Hono<AuthEnv>()

memoriesRoute.use('*', sessionAuth)

memoriesRoute.get('/', async (c) => {
  const rows = await db
    .select()
    .from(userMemories)
    .where(eq(userMemories.userId, c.get('user').id))
    .orderBy(asc(userMemories.id))
  return ok(c, { items: rows.map(toDTO), enabled: memoryExtractionReady() })
})

memoriesRoute.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) {
    return fail(c, 'invalid id')
  }
  let body: { content?: unknown; category?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return fail(c, 'invalid request body')
  }
  const content = truncateRunes(
    String(body.content ?? '').trim(),
    MAX_MEMORY_INPUT_RUNES
  )
  if (content === '') {
    return fail(c, 'content is required')
  }
  const updates: Partial<MemoryRow> = { content, updatedAt: Math.floor(Date.now() / 1000) }
  // An absent category keeps the stored classification; only an explicit
  // value is normalized (unknown values fall back to "other").
  if (body.category !== undefined && body.category !== null) {
    const category = String(body.category).trim().toLowerCase()
    updates.category =
      category === 'profile' || category === 'preference' || category === 'project'
        ? category
        : 'other'
  }
  const updated = await db
    .update(userMemories)
    .set(updates)
    .where(and(eq(userMemories.id, id), eq(userMemories.userId, c.get('user').id)))
    .returning({ id: userMemories.id })
  if (updated.length === 0) {
    return fail(c, 'memory not found')
  }
  return ok(c, null)
})

memoriesRoute.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) {
    return fail(c, 'invalid id')
  }
  const deleted = await db
    .delete(userMemories)
    .where(and(eq(userMemories.id, id), eq(userMemories.userId, c.get('user').id)))
    .returning({ id: userMemories.id })
  if (deleted.length === 0) {
    return fail(c, 'memory not found')
  }
  return ok(c, null)
})

memoriesRoute.delete('/', async (c) => {
  await db.delete(userMemories).where(eq(userMemories.userId, c.get('user').id))
  return ok(c, null)
})
