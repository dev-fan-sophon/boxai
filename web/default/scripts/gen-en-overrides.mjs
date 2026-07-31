/**
 * Translation keys are the English source strings, so all but a handful of
 * `en.json` entries map a key onto itself and i18next already returns the key
 * when a lookup misses. Bundling the full file therefore ships ~440 kB of
 * redundant JSON on the critical path. This emits only the entries whose value
 * differs from its key, which is the part English actually needs at runtime.
 *
 * Usage:
 *   node scripts/gen-en-overrides.mjs            # regenerate
 *   node scripts/gen-en-overrides.mjs --check    # fail if the file is stale
 */
import fs from 'node:fs/promises'
import path from 'node:path'

// This script is executed from the web/ package root (see package.json script).
const SOURCE = path.resolve('src/i18n/locales/en.json')
const OUT = path.resolve('src/i18n/en-overrides.generated.json')

async function main() {
  const check = process.argv.includes('--check')
  const source = JSON.parse(await fs.readFile(SOURCE, 'utf8'))
  const translation = source.translation ?? {}

  const overrides = {}
  for (const key of Object.keys(translation).sort()) {
    if (translation[key] !== key) overrides[key] = translation[key]
  }

  const content = `${JSON.stringify(overrides, null, 2)}\n`

  if (!check) {
    await fs.writeFile(OUT, content, 'utf8')
  } else {
    const current = await fs.readFile(OUT, 'utf8').catch(() => null)
    if (current !== content) {
      console.error(
        'en overrides: generated file is out of date. Run `node scripts/gen-en-overrides.mjs`.'
      )
      process.exit(1)
    }
  }

  console.log(
    `en overrides: ${Object.keys(overrides).length} of ${Object.keys(translation).length} keys kept${
      check ? ' (up to date)' : ''
    }`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
