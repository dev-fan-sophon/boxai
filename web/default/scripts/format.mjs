import { spawnSync } from 'node:child_process'

const mode = process.argv[2]

if (mode !== '--check' && mode !== '--write') {
  console.error('Usage: node scripts/format.mjs --check|--write')
  process.exit(2)
}

const result = spawnSync(
  'oxfmt',
  [
    '-c',
    '.oxfmtrc.json',
    '--ignore-path',
    '.gitignore',
    mode === '--check' ? '--check' : '--write',
    '.',
  ],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
  }
)

process.exit(result.status ?? 1)
