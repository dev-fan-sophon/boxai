import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isTrialGrantExpired,
  normalizeTrialVerificationCode,
} from '../lib/trial-credit'
import type { TrialGrant } from '../types'

const approvedGrant: TrialGrant = {
  status: 'approved',
  total: 100,
  remaining: 75,
  reserved: 5,
  used: 20,
  expires_at: 1_800_000_000,
  models: ['gpt-4o-mini'],
}

afterEach(() => vi.useRealTimers())

describe('trial credit card behavior', () => {
  it('accepts six-character hexadecimal email verification codes', () => {
    expect(normalizeTrialVerificationCode(' aB-19z_F0 ')).toBe('AB19F0')
  })

  it('marks only expired approved grants as expired', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))

    expect(isTrialGrantExpired(approvedGrant)).toBe(true)
    expect(isTrialGrantExpired({ ...approvedGrant, status: 'pending' })).toBe(
      false
    )
  })
})
