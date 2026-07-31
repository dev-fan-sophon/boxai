import { api } from '@/lib/api'

export type CloudflareDNSRecord = {
  id: string
  type: string
  name: string
  proxied: boolean
  proxiable: boolean
}

export type CloudflareRule = {
  id?: string
  description: string
  expression: string
  action: string
  enabled: boolean
  ratelimit?: {
    period: number
    requests_per_period: number
  } | null
}

export type CloudflareBotSettings = {
  fight_mode: boolean
  ai_bots_protection?: string
  crawler_protection?: string
}

export type CloudflareStatus = {
  configured: boolean
  zone_id?: string
  account_id?: string
  zone_name?: string
  plan?: string
  dns_records?: CloudflareDNSRecord[]
  zone_settings?: Record<string, string | number>
  bot?: CloudflareBotSettings | null
  rate_limit_rules?: CloudflareRule[]
  firewall_rules?: CloudflareRule[]
  credential_endpoints?: string[]
  rate_periods?: number[]
  rule_actions?: string[]
}

export type CloudflareProtectionProfile = {
  rate_limit_enabled: boolean
  rate_limit_requests: number
  rate_limit_period: number
  rate_limit_action: string
  challenge_enabled: boolean
  challenge_hosts: string[]
  challenge_action: string
}

type ApiEnvelope<T> = {
  success: boolean
  message?: string
  data?: T
}

export async function getCloudflareStatus() {
  const res = await api.get<ApiEnvelope<CloudflareStatus>>(
    '/api/cloudflare/status'
  )
  return res.data
}

export async function verifyCloudflareCredentials() {
  const res = await api.post<ApiEnvelope<{ zone_name: string; plan: string }>>(
    '/api/cloudflare/verify'
  )
  return res.data
}

export async function updateCloudflareDNSProxy(request: {
  record_id: string
  proxied: boolean
}) {
  const res = await api.put<ApiEnvelope<null>>(
    '/api/cloudflare/dns-proxy',
    request
  )
  return res.data
}

export async function updateCloudflareZoneSetting(request: {
  name: string
  value: string
}) {
  const res = await api.put<ApiEnvelope<null>>(
    '/api/cloudflare/zone-setting',
    request
  )
  return res.data
}

export async function updateCloudflareBotFightMode(request: {
  fight_mode: boolean
}) {
  const res = await api.put<ApiEnvelope<null>>('/api/cloudflare/bot', request)
  return res.data
}

export async function applyCloudflareProtection(
  profile: CloudflareProtectionProfile
) {
  const res = await api.put<ApiEnvelope<null>>(
    '/api/cloudflare/protection',
    profile
  )
  return res.data
}
