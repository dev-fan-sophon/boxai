type StatusRecord = Record<string, unknown> | null | undefined

/**
 * API origin shown to users for SDKs and clients: the admin API base URL,
 * else the server address, else this site. The API host may skip the CDN
 * edge so long non-streaming requests are not cut by its timeout.
 * Without a status argument the cached `/api/status` in localStorage is used.
 */
export function resolveApiBaseUrl(status?: StatusRecord): string {
  let source = status
  if (source === undefined && typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem('status')
      source = raw ? (JSON.parse(raw) as StatusRecord) : null
    } catch {
      source = null
    }
  }
  const data = source?.data as StatusRecord
  const candidates = [
    source?.api_base_url,
    data?.api_base_url,
    source?.server_address,
    data?.server_address,
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim().replace(/\/+$/, '')
    }
  }
  return typeof window !== 'undefined' ? window.location.origin : ''
}
