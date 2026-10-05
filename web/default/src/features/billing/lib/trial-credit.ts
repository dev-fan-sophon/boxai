import type { TrialGrant } from '../types'

export function normalizeTrialVerificationCode(value: string): string {
  return value
    .replaceAll(/[^a-f0-9]/gi, '')
    .slice(0, 6)
    .toUpperCase()
}

export function isTrialGrantExpired(grant: TrialGrant): boolean {
  return grant.status === 'approved' && grant.expires_at * 1000 <= Date.now()
}
