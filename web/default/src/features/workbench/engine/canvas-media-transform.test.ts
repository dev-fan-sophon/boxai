import { describe, expect, it } from 'vitest'

import { keyboardStep, normalizeCrop } from './canvas-media-transform'

describe('canvas media interaction logic', () => {
  it('normalizes a free crop dragged in either direction', () => {
    expect(normalizeCrop({ x: 90, y: 70 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 80,
      height: 50,
    })
  })

  it('uses a precise step normally and a larger step with Shift', () => {
    expect(keyboardStep(false)).toBe(1)
    expect(keyboardStep(true)).toBe(10)
  })
})
