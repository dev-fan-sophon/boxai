#!/usr/bin/env node
/**
 * Icon import lint — guards the two import shapes that silently add megabytes.
 *
 *  1. `@lobehub/icons` barrel imports (`import { X } from '@lobehub/icons'`, or
 *     a namespace import) pull all ~309 brand modules into whichever chunk
 *     touches them. Brands resolved from API data must go through `LobeIcon`,
 *     which loads one generated chunk per brand; a brand known at build time
 *     must be deep-imported from `@lobehub/icons/es/<Brand>`.
 *  2. `react-icons` pack imports must be static and named. A namespace or
 *     dynamic import of a pack defeats tree-shaking and bundles the entire
 *     family — `react-icons/gi` alone is 6.5 MB.
 *
 * These are import-shape rules about specific packages, which oxlint's
 * configured rule set does not cover.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

/** The one module allowed to name every brand: it is generated, one chunk each. */
const LOBE_REGISTRY = 'src/lib/lobe-icon-registry.generated.ts'

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* walk(full)
    } else if (/\.(?:ts|tsx)$/.test(entry)) {
      yield full
    }
  }
}

const problems = []

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file)
  if (rel === LOBE_REGISTRY) continue

  const lines = readFileSync(file, 'utf8').split('\n')

  lines.forEach((line, index) => {
    const at = `${rel}:${index + 1}`
    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) {
      return
    }

    if (/from\s+'@lobehub\/icons'/.test(line)) {
      problems.push(
        `${at}  barrel import of @lobehub/icons bundles all ~309 brands — use <LobeIcon name /> for API-driven keys, or deep-import '@lobehub/icons/es/<Brand>'.`
      )
    }

    if (
      /import\s+\*\s+as\s+\w+\s+from\s+'(@lobehub\/icons|react-icons)/.test(
        line
      )
    ) {
      problems.push(
        `${at}  namespace import of an icon package cannot be tree-shaken — import the icons you need by name.`
      )
    }

    if (/import\(\s*'react-icons/.test(line)) {
      problems.push(
        `${at}  dynamic import of a react-icons pack bundles the whole family — add the icon to src/lib/payment-icons.ts instead.`
      )
    }
  })
}

if (problems.length > 0) {
  console.error(`icon import lint: ${problems.length} problem(s)\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}

console.log('icon import lint: no icon barrel or namespace imports.')
