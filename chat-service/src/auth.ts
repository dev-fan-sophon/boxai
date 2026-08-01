import { createMiddleware } from 'hono/factory'

import { resolveSession } from './gateway/client'
import type { GatewayUser } from './gateway/client'

/**
 * The gateway remains the single authority on identity: this middleware
 * forwards the browser's cookie to /api/internal/session and caches the
 * result briefly so a streaming conversation does not hammer the gateway.
 */

const SESSION_CACHE_TTL_MS = 30_000
const sessionCache = new Map<string, { user: GatewayUser; expires: number }>()

export type AuthEnv = { Variables: { user: GatewayUser } }

export const sessionAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const cookie = c.req.header('cookie')
  if (!cookie) {
    return c.json({ success: false, message: 'not logged in' }, 401)
  }
  const cached = sessionCache.get(cookie)
  if (cached && cached.expires > Date.now()) {
    c.set('user', cached.user)
    return next()
  }
  let user: GatewayUser
  try {
    user = await resolveSession(cookie)
  } catch {
    sessionCache.delete(cookie)
    return c.json({ success: false, message: 'not logged in' }, 401)
  }
  if (sessionCache.size > 10_000) {
    sessionCache.clear()
  }
  sessionCache.set(cookie, { user, expires: Date.now() + SESSION_CACHE_TTL_MS })
  c.set('user', user)
  return next()
})
