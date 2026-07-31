import { describe, expect, it } from 'vitest'

import {
  brandPrimaryForeground,
  deriveDarkBrandPrimary,
  effectiveDarkBrandPrimary,
  isAccessibleBrandPrimary,
  isAccessibleBrandPrimaryForDark,
  isAccessibleBrandPrimaryForLight,
} from './colors'

// Keep these in lockstep with common/brand_color.go — admin API and UI must agree.

describe('brandPrimaryForeground', () => {
  it.each([
    ['#2563EB', '#ffffff'],
    ['#047857', '#ffffff'],
    ['#D97706', '#0b1633'],
    ['#22D3EE', '#0b1633'],
  ])('picks the legible label for %s', (color, expected) => {
    expect(brandPrimaryForeground(color)).toBe(expected)
  })
})

describe('isAccessibleBrandPrimaryForLight', () => {
  it.each([
    ['#2563EB', true],
    ['#E05A3A', true],
    ['#D97706', true],
    ['#22D3EE', false],
    ['#FFFFFF', false],
    ['#12345G', false],
    ['2563EB', false],
  ])('%s → %s', (color, expected) => {
    expect(isAccessibleBrandPrimaryForLight(color)).toBe(expected)
  })
})

describe('isAccessibleBrandPrimaryForDark', () => {
  it.each([
    ['#E05A3A', true],
    ['#FF9072', true],
    ['#22D3EE', true],
    ['#000000', false],
    ['#0B1633', false],
  ])('%s → %s', (color, expected) => {
    expect(isAccessibleBrandPrimaryForDark(color)).toBe(expected)
  })
})

describe('isAccessibleBrandPrimary (dual)', () => {
  it.each([
    ['#2563EB', true],
    ['#047857', true],
    ['#D97706', true],
    ['#22D3EE', false],
    ['#FFFFFF', false],
    ['#000000', false],
  ])('%s → %s', (color, expected) => {
    expect(isAccessibleBrandPrimary(color)).toBe(expected)
  })
})

describe('deriveDarkBrandPrimary', () => {
  it('softens BoxAI coral and stays accessible on dark', () => {
    const dark = deriveDarkBrandPrimary('#E05A3A')
    expect(isAccessibleBrandPrimaryForDark(dark)).toBe(true)
    expect(dark).not.toBe('#E05A3A')
    // Locked to Go common.DeriveDarkBrandPrimary("#E05A3A")
    expect(dark).toBe('#FF9072')
  })

  it('honors an explicit dark override in effectiveDarkBrandPrimary', () => {
    expect(effectiveDarkBrandPrimary('#E05A3A', '#FF9072')).toBe('#FF9072')
    expect(effectiveDarkBrandPrimary('#E05A3A', 'nope')).toBe(
      deriveDarkBrandPrimary('#E05A3A')
    )
  })
})
