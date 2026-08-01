import { and, desc, eq, notInArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { randomBytes } from 'node:crypto'

import { sessionAuth } from '../auth'
import type { AuthEnv } from '../auth'
import { db } from '../db'
import { canvasProjects, canvasShares, canvasVersions } from '../db/schema'
import { fail, ok, truncateRunes } from '../http'
import { canvasShareTokenHash } from './canvas-share'

/**
 * Wire parity with the gateway's playground canvas endpoints. The Go structs
 * mark user_id (and the legacy inspiration columns) json:"-", so they never
 * appear on the wire; updated_at doubles as the compare-and-swap token the
 * frontend echoes back as base_updated_at.
 */

type ProjectRow = typeof canvasProjects.$inferSelect
type VersionRow = typeof canvasVersions.$inferSelect

const DOC_MAX_BYTES = 2_000_000
const VERSION_INTERVAL_SECONDS = 600
const VERSION_LIMIT = 20

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function projectDTO(row: Pick<ProjectRow, 'id' | 'title' | 'cover' | 'createdAt' | 'updatedAt'> & { doc?: string | null }) {
  return {
    id: row.id,
    title: row.title,
    doc: row.doc ?? '',
    cover: row.cover ?? '',
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

function versionDTO(row: Pick<VersionRow, 'id' | 'projectId' | 'title' | 'createdAt'> & { doc?: string | null }) {
  const dto: Record<string, unknown> = {
    id: row.id,
    project_id: row.projectId,
    title: row.title,
    created_at: row.createdAt,
  }
  // Go tags Doc as json:"doc,omitempty", so the list view (which never loads
  // documents) must not emit the field at all.
  if (row.doc) dto.doc = row.doc
  return dto
}

async function readJson(c: { req: { json: () => Promise<unknown> } }) {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  } catch {
    return null
  }
}

function parseId(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const id = Number.parseInt(raw, 10)
  if (Number.isNaN(id) || id <= 0) return null
  return id
}

/**
 * Stores the project's current document as a version, throttled to one
 * snapshot per interval, then prunes snapshots beyond the per-project cap.
 */
async function snapshotProject(project: ProjectRow): Promise<void> {
  const now = nowSeconds()
  const [newest] = await db
    .select({ createdAt: canvasVersions.createdAt })
    .from(canvasVersions)
    .where(and(eq(canvasVersions.projectId, project.id), eq(canvasVersions.userId, project.userId)))
    .orderBy(desc(canvasVersions.createdAt), desc(canvasVersions.id))
    .limit(1)
  if (newest && now - newest.createdAt < VERSION_INTERVAL_SECONDS) return

  await db.insert(canvasVersions).values({
    projectId: project.id,
    userId: project.userId,
    title: project.title,
    doc: project.doc ?? '',
    createdAt: now,
  })

  const keep = await db
    .select({ id: canvasVersions.id })
    .from(canvasVersions)
    .where(eq(canvasVersions.projectId, project.id))
    .orderBy(desc(canvasVersions.createdAt), desc(canvasVersions.id))
    .limit(VERSION_LIMIT)
  if (keep.length < VERSION_LIMIT) return
  await db.delete(canvasVersions).where(
    and(
      eq(canvasVersions.projectId, project.id),
      notInArray(
        canvasVersions.id,
        keep.map((row) => row.id)
      )
    )
  )
}

async function getProject(id: number, userId: number): Promise<ProjectRow | null> {
  const [row] = await db
    .select()
    .from(canvasProjects)
    .where(and(eq(canvasProjects.id, id), eq(canvasProjects.userId, userId)))
    .limit(1)
  return row ?? null
}

export const canvasRoute = new Hono<AuthEnv>()

canvasRoute.use('*', sessionAuth)

canvasRoute.get('/', async (c) => {
  const userId = c.get('user').id
  let page = Number.parseInt((c.req.query('p') ?? '').trim(), 10)
  if (Number.isNaN(page) || page < 0) page = 0
  let pageSize = Number.parseInt((c.req.query('page_size') ?? '').trim(), 10)
  if (Number.isNaN(pageSize) || pageSize <= 0) pageSize = 50
  if (pageSize > 100) pageSize = 100

  // Legacy inspiration-canvas rows never carry a doc and stay out of the grid.
  const scope = and(eq(canvasProjects.userId, userId), sql`${canvasProjects.doc} IS NOT NULL AND ${canvasProjects.doc} <> ''`)
  const [counted] = await db.select({ total: sql<number>`count(*)` }).from(canvasProjects).where(scope)
  const rows = await db
    .select({
      id: canvasProjects.id,
      title: canvasProjects.title,
      cover: canvasProjects.cover,
      createdAt: canvasProjects.createdAt,
      updatedAt: canvasProjects.updatedAt,
    })
    .from(canvasProjects)
    .where(scope)
    .orderBy(desc(canvasProjects.updatedAt), desc(canvasProjects.id))
    .offset(page * pageSize)
    .limit(pageSize)

  return ok(c, { projects: rows.map((row) => projectDTO(row)), total: Number(counted?.total ?? 0) })
})

canvasRoute.post('/', async (c) => {
  const userId = c.get('user').id
  const body = await readJson(c)
  if (!body) return fail(c, 'invalid request body')
  const doc = typeof body.doc === 'string' ? body.doc : ''
  if (Buffer.byteLength(doc, 'utf8') > DOC_MAX_BYTES) return fail(c, 'canvas document is too large')
  let title = (typeof body.title === 'string' ? body.title : '').trim()
  if (title === '') title = 'Untitled canvas'
  const cover = truncateRunes((typeof body.cover === 'string' ? body.cover : '').trim(), 500)
  const now = nowSeconds()
  const [row] = await db
    .insert(canvasProjects)
    .values({
      userId,
      title: truncateRunes(title, 120),
      doc,
      cover,
      snapshot: '',
      revision: 0,
      inspirationTemplateId: 0,
      inspirationVersionId: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  if (!row) return fail(c, 'failed to create canvas project')
  return ok(c, projectDTO(row))
})

canvasRoute.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return fail(c, 'invalid id')
  const project = await getProject(id, c.get('user').id)
  if (!project) return fail(c, 'canvas project not found')
  return ok(c, projectDTO(project))
})

async function updateProject(c: Context<AuthEnv>) {
  const userId = c.get('user').id
  const id = parseId(c.req.param('id'))
  if (id === null) return fail(c, 'invalid id')
  const body = await readJson(c)
  if (!body) return fail(c, 'invalid request body')

  const updates: Record<string, unknown> = {}
  if (typeof body.title === 'string' || body.title === null) {
    let title = typeof body.title === 'string' ? body.title.trim() : ''
    if (title === '') title = 'Untitled canvas'
    updates.title = truncateRunes(title, 120)
  }
  if (typeof body.cover === 'string' || body.cover === null) {
    updates.cover = truncateRunes(typeof body.cover === 'string' ? body.cover.trim() : '', 500)
  }
  const hasDoc = typeof body.doc === 'string' || body.doc === null
  if (hasDoc) {
    const doc = typeof body.doc === 'string' ? body.doc : ''
    if (Buffer.byteLength(doc, 'utf8') > DOC_MAX_BYTES) return fail(c, 'canvas document is too large')
    updates.doc = doc
  }
  if (Object.keys(updates).length === 0) return fail(c, 'nothing to update')

  const baseUpdatedAt = typeof body.base_updated_at === 'number' ? body.base_updated_at : 0

  if (hasDoc) {
    const previous = await getProject(id, userId)
    if (previous) {
      try {
        await snapshotProject(previous)
      } catch (error) {
        console.error('failed to snapshot canvas project:', error)
      }
    }
  }

  let newUpdatedAt = nowSeconds()
  if (newUpdatedAt <= baseUpdatedAt) newUpdatedAt = baseUpdatedAt + 1
  const updated = await db
    .update(canvasProjects)
    .set({ ...updates, updatedAt: newUpdatedAt })
    .where(
      and(
        eq(canvasProjects.id, id),
        eq(canvasProjects.userId, userId),
        eq(canvasProjects.updatedAt, baseUpdatedAt)
      )
    )
    .returning({ id: canvasProjects.id })
  if (updated.length === 0) {
    const existing = await getProject(id, userId)
    if (!existing) return fail(c, 'canvas project not found')
    return fail(c, 'canvas project was modified elsewhere')
  }
  return ok(c, { updated_at: newUpdatedAt })
}

canvasRoute.put('/:id', updateProject)
canvasRoute.patch('/:id', updateProject)

canvasRoute.delete('/:id', async (c) => {
  const userId = c.get('user').id
  const id = parseId(c.req.param('id'))
  if (id === null) return fail(c, 'invalid id')
  const deleted = await db
    .delete(canvasProjects)
    .where(and(eq(canvasProjects.id, id), eq(canvasProjects.userId, userId)))
    .returning({ id: canvasProjects.id })
  if (deleted.length === 0) return fail(c, 'canvas project not found')
  await db.delete(canvasVersions).where(eq(canvasVersions.projectId, id))
  await db.delete(canvasShares).where(eq(canvasShares.projectId, id))
  return ok(c, null)
})

canvasRoute.get('/:id/versions', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return fail(c, 'invalid id')
  const rows = await db
    .select({
      id: canvasVersions.id,
      projectId: canvasVersions.projectId,
      title: canvasVersions.title,
      createdAt: canvasVersions.createdAt,
    })
    .from(canvasVersions)
    .where(and(eq(canvasVersions.projectId, id), eq(canvasVersions.userId, c.get('user').id)))
    .orderBy(desc(canvasVersions.createdAt), desc(canvasVersions.id))
  return ok(c, { versions: rows.map((row) => versionDTO(row)) })
})

canvasRoute.get('/:id/versions/:versionId', async (c) => {
  const id = parseId(c.req.param('id'))
  if (id === null) return fail(c, 'invalid id')
  const versionId = parseId(c.req.param('versionId'))
  if (versionId === null) return fail(c, 'invalid version id')
  const [row] = await db
    .select()
    .from(canvasVersions)
    .where(
      and(
        eq(canvasVersions.id, versionId),
        eq(canvasVersions.projectId, id),
        eq(canvasVersions.userId, c.get('user').id)
      )
    )
    .limit(1)
  if (!row) return fail(c, 'canvas version not found')
  return ok(c, versionDTO(row))
})

async function createShare(c: Context<AuthEnv>) {
  const userId = c.get('user').id
  const projectId = parseId(c.req.param('id'))
  if (projectId === null) return fail(c, 'invalid id')
  const body = await readJson(c)
  if (!body) return fail(c, 'invalid request body')
  const expiresInDays = typeof body.expires_in_days === 'number' ? body.expires_in_days : 0
  if (expiresInDays !== 0 && expiresInDays !== 7 && expiresInDays !== 30) {
    return fail(c, 'expiration must be 7, 30, or 0 days')
  }
  if (!(await getProject(projectId, userId))) return fail(c, 'canvas project not found')

  const token = randomBytes(32).toString('base64url')
  const now = nowSeconds()
  const expiresAt = expiresInDays > 0 ? now + expiresInDays * 24 * 60 * 60 : 0

  const [existing] = await db
    .select()
    .from(canvasShares)
    .where(and(eq(canvasShares.projectId, projectId), eq(canvasShares.userId, userId)))
    .limit(1)
  if (!existing) {
    const [created] = await db
      .insert(canvasShares)
      .values({
        projectId,
        userId,
        tokenHash: canvasShareTokenHash(token),
        expiresAt,
        revokedAt: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    if (!created) return fail(c, 'failed to create canvas share')
    return ok(c, { token, expires_at: created.expiresAt, created_at: created.createdAt })
  }
  await db
    .update(canvasShares)
    .set({ tokenHash: canvasShareTokenHash(token), expiresAt, revokedAt: 0, updatedAt: now })
    .where(eq(canvasShares.id, existing.id))
  return ok(c, { token, expires_at: expiresAt, created_at: existing.createdAt })
}

canvasRoute.post('/:id/share', createShare)
canvasRoute.post('/:id/share/rotate', createShare)

canvasRoute.get('/:id/share', async (c) => {
  const projectId = parseId(c.req.param('id'))
  if (projectId === null) return fail(c, 'invalid id')
  const [share] = await db
    .select()
    .from(canvasShares)
    .where(and(eq(canvasShares.projectId, projectId), eq(canvasShares.userId, c.get('user').id)))
    .limit(1)
  if (!share) return ok(c, { active: false })
  const active = share.revokedAt === 0 && (share.expiresAt === 0 || share.expiresAt > nowSeconds())
  return ok(c, { active, expires_at: share.expiresAt, created_at: share.createdAt })
})

canvasRoute.delete('/:id/share', async (c) => {
  const projectId = parseId(c.req.param('id'))
  if (projectId === null) return fail(c, 'invalid id')
  const now = nowSeconds()
  await db
    .update(canvasShares)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(canvasShares.projectId, projectId), eq(canvasShares.userId, c.get('user').id)))
  return ok(c, null)
})
