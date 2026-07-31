#!/usr/bin/env node
/**
 * Guards the status color contract.
 *
 * A status surface built by hand — `bg-emerald-50 … text-emerald-700` and its
 * dark-mode twin — pairs two shades that nobody contrast-checked, and it drifts
 * per call site. `src/lib/tone.ts` resolves the same intent to the
 * `*-subtle` token pair, which is checked against its own foreground in both
 * schemes.
 *
 * Only the *paired* form is rejected: a lone `text-emerald-600` on an inherited
 * background, brand gradients, and vendor accents are all legitimate and stay
 * untouched. The budget below is the count that still exists in files this
 * guard has not migrated yet; it may only ever go down.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { globSync } from 'tinyglobby'

const STATUS_FAMILIES = [
  'emerald',
  'green',
  'lime',
  'teal',
  'red',
  'rose',
  'amber',
  'yellow',
  'orange',
]

// A background shade and a text shade from the same status family inside one
// class string is the quartet this guard is meant to catch.
const PAIRED = new RegExp(
  `bg-(${STATUS_FAMILIES.join('|')})-\\d{2,3}(?:/\\d+)?[^'"\`]*?\\btext-\\1-\\d{2,3}`
)

const BUDGET = 38

const root = process.cwd()
const files = globSync('src/**/*.{ts,tsx}', { cwd: root, absolute: true })

const offenders = []
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  source.split('\n').forEach((line, index) => {
    if (PAIRED.test(line)) {
      offenders.push(`${file.slice(root.length + 1)}:${index + 1}`)
    }
  })
}

if (offenders.length > BUDGET) {
  const shown = offenders.slice(0, 20)
  console.error(
    `status color lint: ${offenders.length} hand-paired status surfaces, budget is ${BUDGET}.`
  )
  console.error('Use tone()/toneText() from @/lib/tone instead:')
  for (const offender of shown) console.error(`  ${offender}`)
  if (offenders.length > shown.length) {
    console.error(`  … and ${offenders.length - shown.length} more`)
  }
  process.exit(1)
}

if (offenders.length < BUDGET) {
  console.error(
    `status color lint: ${offenders.length} remaining, below the recorded budget of ${BUDGET}.`
  )
  console.error(
    `Lower BUDGET to ${offenders.length} in ${join('scripts', 'check-status-colors.mjs')} to lock in the progress.`
  )
  process.exit(1)
}

console.log(`status color lint: ${offenders.length} legacy pairs, none added.`)
