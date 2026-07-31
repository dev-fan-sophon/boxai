import { describe, expect, it } from 'vitest'

import { createTokenAxisFormatter } from './format'

describe('createTokenAxisFormatter', () => {
  it('keeps every tick on one axis in the same unit and precision', () => {
    const format = createTokenAxisFormatter(2_000_000)

    // formatTokens alone would render these as "500K" and "1.00M", mixing
    // both the unit and the decimal count within a single axis.
    expect(format(500_000)).toBe('0.5M')
    expect(format(1_000_000)).toBe('1.0M')
    expect(format(1_500_000)).toBe('1.5M')
    expect(format(2_000_000)).toBe('2.0M')
  })

  it('drops decimals once the scaled value no longer needs them', () => {
    const format = createTokenAxisFormatter(90_000_000)

    expect(format(10_000_000)).toBe('10M')
    expect(format(90_000_000)).toBe('90M')
  })

  it('falls back to plain counts below the smallest unit', () => {
    const format = createTokenAxisFormatter(800)

    expect(format(250)).toBe('250')
    expect(format(800)).toBe('800')
  })

  it('renders non-positive and non-finite ticks as zero', () => {
    const format = createTokenAxisFormatter(5_000_000)

    expect(format(0)).toBe('0')
    expect(format(-10)).toBe('0')
    expect(format(Number.NaN)).toBe('0')
  })
})
