import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { sessionAuth } from '../auth'
import type { AuthEnv } from '../auth'
import { db } from '../db'
import { personas } from '../db/schema'
import { fail, ok, truncateRunes } from '../http'

const MAX_NAME_RUNES = 128
const MAX_PROMPT_RUNES = 8000

type PersonaRow = typeof personas.$inferSelect

function toDTO(row: PersonaRow) {
  return {
    id: row.id,
    user_id: row.userId,
    name: row.name,
    system_prompt: row.systemPrompt ?? '',
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

export const personasRoute = new Hono<AuthEnv>()

personasRoute.use('*', sessionAuth)

personasRoute.get('/', async (c) => {
  const rows = await db
    .select()
    .from(personas)
    .where(eq(personas.userId, c.get('user').id))
    .orderBy(desc(personas.id))
  return ok(c, rows.map(toDTO))
})

personasRoute.post('/', async (c) => {
  let body: { name?: unknown; system_prompt?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return fail(c, 'invalid request body')
  }
  const name = String(body.name ?? '').trim()
  if (name === '') {
    return fail(c, 'name is required')
  }
  const now = Math.floor(Date.now() / 1000)
  const inserted = await db
    .insert(personas)
    .values({
      userId: c.get('user').id,
      name: truncateRunes(name, MAX_NAME_RUNES),
      systemPrompt: truncateRunes(String(body.system_prompt ?? ''), MAX_PROMPT_RUNES),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return ok(c, toDTO(inserted[0]!))
})

personasRoute.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) {
    return fail(c, 'invalid id')
  }
  const userId = c.get('user').id
  const existing = await db
    .select()
    .from(personas)
    .where(and(eq(personas.id, id), eq(personas.userId, userId)))
    .limit(1)
  if (existing.length === 0) {
    return fail(c, 'persona not found')
  }
  let body: { name?: unknown; system_prompt?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return fail(c, 'invalid request body')
  }
  const row = existing[0]!
  let name = row.name
  let systemPrompt = row.systemPrompt ?? ''
  if (body.name !== undefined && body.name !== null) {
    const next = String(body.name).trim()
    if (next === '') {
      return fail(c, 'name is required')
    }
    name = truncateRunes(next, MAX_NAME_RUNES)
  }
  if (body.system_prompt !== undefined && body.system_prompt !== null) {
    systemPrompt = truncateRunes(String(body.system_prompt), MAX_PROMPT_RUNES)
  }
  const updatedAt = Math.floor(Date.now() / 1000)
  const updated = await db
    .update(personas)
    .set({ name, systemPrompt, updatedAt })
    .where(and(eq(personas.id, id), eq(personas.userId, userId)))
    .returning()
  if (updated.length === 0) {
    return fail(c, 'persona not found')
  }
  return ok(c, toDTO(updated[0]!))
})

personasRoute.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) {
    return fail(c, 'invalid id')
  }
  const deleted = await db
    .delete(personas)
    .where(and(eq(personas.id, id), eq(personas.userId, c.get('user').id)))
    .returning({ id: personas.id })
  if (deleted.length === 0) {
    return fail(c, 'persona not found')
  }
  return ok(c, null)
})
