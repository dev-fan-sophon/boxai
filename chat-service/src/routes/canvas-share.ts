import { and, eq, gt, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { createHash } from 'node:crypto'

import { config } from '../config'
import { db } from '../db'
import { canvasProjects, canvasShares } from '../db/schema'
import { ok } from '../http'

/**
 * Public, unauthenticated share access. The gateway answers every invalid,
 * expired, or revoked token with a bare 404 (never the JSON envelope) so a
 * share link leaks nothing about whether a project exists; that is preserved
 * here. Only the token digest is stored, so a leaked database row cannot be
 * turned back into a working link.
 */

const TOKEN_LENGTH = 43

export function canvasShareTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

type RewrittenDoc = {
  doc: string
  assetIds: Set<number>
  replacements: Map<string, string>
}

/**
 * Walks the canvas document and swaps every asset reference for a proxy URL
 * under the share token, collecting the asset ids the shared document is
 * actually allowed to serve.
 */
export function rewriteCanvasShareDocument(doc: string, token: string): RewrittenDoc | null {
  let value: unknown
  try {
    value = JSON.parse(doc)
  } catch {
    return null
  }
  const assetIds = new Set<number>()
  const replacements = new Map<string, string>()
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const child of current) visit(child)
      return
    }
    if (!current || typeof current !== 'object') return
    const item = current as Record<string, unknown>
    const assetNumber = item.assetId
    if (typeof assetNumber === 'number' && Number.isInteger(assetNumber) && assetNumber > 0) {
      assetIds.add(assetNumber)
      const proxy = `/api/share/canvas/${token}/assets/${assetNumber}`
      const content = item.content
      if (typeof content === 'string' && content !== '') {
        replacements.set(content, proxy)
        item.content = proxy
      }
    }
    for (const child of Object.values(item)) visit(child)
  }
  visit(value)
  return { doc: JSON.stringify(value), assetIds, replacements }
}

async function activeShare(token: string) {
  const now = Math.floor(Date.now() / 1000)
  const [row] = await db
    .select({ project: canvasProjects, userId: canvasShares.userId })
    .from(canvasShares)
    .innerJoin(
      canvasProjects,
      and(eq(canvasProjects.id, canvasShares.projectId), eq(canvasProjects.userId, canvasShares.userId))
    )
    .where(
      and(
        eq(canvasShares.tokenHash, canvasShareTokenHash(token)),
        eq(canvasShares.revokedAt, 0),
        or(eq(canvasShares.expiresAt, 0), gt(canvasShares.expiresAt, sql`${now}`))
      )
    )
    .limit(1)
  return row ?? null
}

export const canvasShareRoute = new Hono()

canvasShareRoute.get('/:token', async (c) => {
  const token = c.req.param('token').trim()
  if (token.length !== TOKEN_LENGTH) return c.body(null, 404)
  const share = await activeShare(token)
  if (!share) return c.body(null, 404)
  const rewritten = rewriteCanvasShareDocument(share.project.doc ?? '', token)
  if (!rewritten) return c.body(null, 404)
  const cover = share.project.cover ?? ''
  return ok(c, {
    title: share.project.title,
    doc: rewritten.doc,
    cover: rewritten.replacements.get(cover) ?? cover,
  })
})

canvasShareRoute.get('/:token/assets/:assetId', async (c) => {
  const token = c.req.param('token').trim()
  const assetId = Number.parseInt(c.req.param('assetId'), 10)
  if (token.length !== TOKEN_LENGTH || Number.isNaN(assetId) || assetId <= 0) return c.body(null, 404)
  const share = await activeShare(token)
  if (!share) return c.body(null, 404)
  const rewritten = rewriteCanvasShareDocument(share.project.doc ?? '', token)
  if (!rewritten || !rewritten.assetIds.has(assetId)) return c.body(null, 404)

  // Asset bytes still live in the gateway's storage; it re-checks ownership
  // for the acted-as user, so a share can only ever serve its owner's assets.
  let upstream: Response
  try {
    upstream = await fetch(`${config.gatewayBaseUrl}/api/internal/playground/assets/${assetId}/content`, {
      headers: {
        'X-BoxAI-Internal-Secret': config.internalSecret,
        'X-BoxAI-Act-As-User': String(share.userId),
      },
    })
  } catch {
    return c.body(null, 404)
  }
  if (!upstream.ok || !upstream.body) return c.body(null, 404)
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
    },
  })
})
