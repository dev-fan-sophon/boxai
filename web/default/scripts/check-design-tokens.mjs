#!/usr/bin/env node
/**
 * Design-token lint — keeps new UI on the token system in `src/styles/`.
 *
 *  1. Arbitrary pixel font sizes (`text-[11px]`) are banned. Use the type
 *     scale: `text-4xs` 9px, `text-3xs` 10px, `text-2xs` 11px, `text-xs`,
 *     `text-ui` 13px, `text-sm`, `text-md` 15px, …
 *  2. Global stacking literals (`z-[70]`, `z-100`, `z-999`) are banned. Use the
 *     named tiers (`z-raised`, `z-sticky`, `z-overlay`, `z-guide`,
 *     `z-floating`, `z-skip-link`); z-1…z-10 stay fine for local stacking.
 *     The shared primitives in `src/components/ui/` go one step further and
 *     may not use the stock `z-20`…`z-50` steps either: an overlay there sets
 *     the stacking order for every feature, so it names its tier.
 *  3. Raw Tailwind palette colors (`text-emerald-600`) and hex literals in
 *     TS/TSX bypass the theme and break dark mode and the runtime brand color.
 *     Existing uses carry a budget that may only ever go down: reach for the
 *     semantic tokens (`text-success`, `bg-warning-subtle`, `tone()` from
 *     `@/lib/tone`, `chart-*`) instead.
 *
 * Generated brand tables and vendor color maps are exempt from rule 3.
 */
import { readFileSync } from 'node:fs'
import process from 'node:process'

import { globSync } from 'tinyglobby'

const PALETTE_BUDGET = 282
const HEX_BUDGET = 97

const EXEMPT = [
  /lobe-brand-colors\.generated\.ts$/,
  /\.test\.tsx?$/,
  /brand-color\.ts$/,
]

const PX_FONT = /\btext-\[\d+(?:\.\d+)?px\]/
const Z_LITERAL = /(?:^|[\s'"`:])-?z-(?:\[\d{2,}\]|[1-9]\d{2,})(?=[\s'"`]|$)/
const Z_STOCK_STEP = /(?:^|[\s'"`:])-?z-[2-5]0(?=[\s'"`]|$)/
const PALETTE =
  /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|decoration|divide|accent|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g
const HEX = /['"`]#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})['"`]/g

const root = process.cwd()
const files = globSync('src/**/*.{ts,tsx}', { cwd: root, absolute: true })

const hardErrors = []
let palette = 0
let hex = 0
const paletteByFile = new Map()

for (const file of files) {
  const rel = file.slice(root.length + 1)
  const source = readFileSync(file, 'utf8')
  source.split('\n').forEach((line, index) => {
    if (PX_FONT.test(line)) {
      hardErrors.push(
        `${rel}:${index + 1} pixel font size — use the type scale`
      )
    }
    if (Z_LITERAL.test(line)) {
      hardErrors.push(
        `${rel}:${index + 1} global z-index literal — use a z-* tier`
      )
    }
    if (rel.startsWith('src/components/ui/') && Z_STOCK_STEP.test(line)) {
      hardErrors.push(
        `${rel}:${index + 1} stock z-index step in a shared primitive — use a z-* tier`
      )
    }
  })
  if (EXEMPT.some((pattern) => pattern.test(rel))) continue
  const paletteHits = source.match(PALETTE)?.length ?? 0
  const hexHits = source.match(HEX)?.length ?? 0
  palette += paletteHits
  hex += hexHits
  if (paletteHits + hexHits) paletteByFile.set(rel, paletteHits + hexHits)
}

let failed = false
if (hardErrors.length) {
  console.error('design token lint:')
  for (const error of hardErrors.slice(0, 30)) {
    console.error(`  ${error}`)
  }
  failed = true
}

const ratchet = (label, count, budget, name) => {
  if (count > budget) {
    console.error(
      `design token lint: ${count} ${label}, budget is ${budget}. Use semantic tokens instead. Top files:`
    )
    const top = [...paletteByFile.entries()].sort((a, b) => b[1] - a[1])
    for (const [file, hits] of top.slice(0, 10)) {
      console.error(`  ${file} (${hits})`)
    }
    failed = true
  } else if (count < budget) {
    console.error(
      `design token lint: ${count} ${label}, below the budget of ${budget}. Lower ${name} in scripts/check-design-tokens.mjs to lock in the progress.`
    )
    failed = true
  }
}
ratchet('raw palette color classes', palette, PALETTE_BUDGET, 'PALETTE_BUDGET')
ratchet('hex color literals', hex, HEX_BUDGET, 'HEX_BUDGET')

if (failed) process.exit(1)
console.log(
  `design token lint: type scale and z tiers clean; ${palette} palette / ${hex} hex legacy uses, none added.`
)
