import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { MOTION_DURATION } from './motion'

const STYLESHEET = join(
  dirname(fileURLToPath(import.meta.url)),
  '../styles/motion.css'
)

function readCssDurations(): Record<string, number> {
  const css = readFileSync(STYLESHEET, 'utf8')
  const tiers: Record<string, number> = {}

  for (const [, tier, value] of css.matchAll(
    /--motion-duration-([a-z]+):\s*(\d+)ms;/g
  )) {
    tiers[tier] = Number(value) / 1000
  }

  return tiers
}

describe('motion duration tiers', () => {
  /* The CSS tokens and the `motion/react` transitions are two independent
   * animation runtimes rendering the same UI. When they disagree a hover and
   * the panel it opens run at different speeds, which reads as jank rather
   * than as a bug — so the drift has to fail the build instead. */
  it('match the --motion-duration-* tokens tier for tier', () => {
    expect(readCssDurations()).toEqual(MOTION_DURATION)
  })

  it('order the tiers from shortest to longest', () => {
    const tiers = Object.values(MOTION_DURATION)
    const ascending = [...tiers].sort((a, b) => a - b)

    expect(tiers).toEqual(ascending)
  })
})
