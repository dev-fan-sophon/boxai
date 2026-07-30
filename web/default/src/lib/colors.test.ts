/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { describe, expect, it } from 'vitest'

import { brandPrimaryForeground, isAccessibleBrandPrimary } from './colors'

// These expectations mirror isAccessibleBrandPrimary in controller/option.go.
// The two implementations must agree, otherwise the admin API rejects a color
// the UI renders fine (or accepts one the UI cannot label legibly).
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

describe('isAccessibleBrandPrimary', () => {
  it.each([
    ['#2563EB', true],
    ['#047857', true],
    // Only 3.18:1 against white, but 5.37:1 against the derived dark label.
    ['#D97706', true],
    // Legible label, but the fill vanishes against the light canvas.
    ['#22D3EE', false],
    ['#FFFFFF', false],
    ['#000000', false],
    ['#12345G', false],
    ['2563EB', false],
  ])('%s → %s', (color, expected) => {
    expect(isAccessibleBrandPrimary(color)).toBe(expected)
  })
})
