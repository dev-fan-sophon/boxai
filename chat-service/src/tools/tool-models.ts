import { toolModels } from '../gateway/client'
import type { ToolModels } from '../gateway/client'
import type { ToolContext } from './index'

/**
 * Platform-selected tool models per (user, group), cached briefly: the
 * selection depends on channel configuration that changes rarely, and a
 * single agent turn may consult it several times.
 */

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { value: ToolModels; expires: number }>()

export async function resolveToolModels(
  context: {
    userId: number
    group: string
  },
  signal?: AbortSignal
): Promise<ToolModels> {
  signal?.throwIfAborted()
  const key = `${context.userId}:${context.group}`
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) {
    return cached.value
  }
  const value = await toolModels(context.userId, context.group, signal)
  if (cache.size > 10_000) {
    cache.clear()
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS })
  return value
}
