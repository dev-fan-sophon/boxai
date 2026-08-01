import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { db } from '../db'
import { agents } from '../db/schema'
import { ok } from '../http'

// Launcher cards are public in the gateway router (no UserAuth), so this
// listing stays unauthenticated.
export const agentsRoute = new Hono()

agentsRoute.get('/', async (c) => {
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.enabled, true))
    .orderBy(asc(agents.sortOrder), asc(agents.id))
  return ok(
    c,
    rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description ?? '',
      category: row.category ?? '',
      icon: row.icon ?? '',
      action_type: row.actionType ?? '',
      action_value: row.actionValue ?? '',
      action_prompt: row.actionPrompt ?? '',
      accent: row.accent ?? '',
      sort_order: row.sortOrder ?? 0,
      enabled: row.enabled ?? false,
      created_at: row.createdAt,
    }))
  )
})
