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

export function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= maxBytes) return value
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let end = maxBytes; end > Math.max(0, maxBytes - 4); end -= 1) {
    try {
      return decoder.decode(bytes.subarray(0, end))
    } catch {
      // Try the previous UTF-8 boundary.
    }
  }
  return ''
}
