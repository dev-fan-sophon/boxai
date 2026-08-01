import type { Context } from 'hono'

/**
 * Response envelope parity with the gateway's common.ApiSuccess/ApiErrorMsg:
 * business failures are HTTP 200 with success=false, because that is what
 * every existing frontend call site expects.
 */

export function ok(c: Context, data: unknown) {
  return c.json({ success: true, message: '', data })
}

export function fail(c: Context, message: string) {
  return c.json({ success: false, message })
}

export function truncateRunes(value: string, max: number): string {
  const runes = Array.from(value)
  return runes.length <= max ? value : runes.slice(0, max).join('')
}
