/**
 * Summarizes `dist/stats.json` (produced by `ANALYZE=1 bun run build`).
 *
 * Reports what lands in the entry bundle, which is the number that decides how
 * long a first-time visitor stares at a blank page. Everything else is only
 * downloaded when a route needs it.
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const statsPath = path.join(rootDir, 'dist/stats.json')

if (!fs.existsSync(statsPath)) {
  console.error('dist/stats.json not found. Run: ANALYZE=1 bun run build')
  process.exit(1)
}

const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'))
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`

function packageOf(name) {
  const external = /node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+)/.exec(name)
  if (external) return external[1].replaceAll('\\', '/')
  const local = /(?:^|[\\/])src[\\/]([^\\/]+(?:[\\/][^\\/]+)?)/.exec(name)
  return local ? `src/${local[1].replaceAll('\\', '/')}` : 'other'
}

function report(title, chunks) {
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.size, 0)
  console.log(`\n${title}  (${chunks.length} chunks, ${kb(totalSize)})`)
  console.log('─'.repeat(64))

  const bySource = new Map()
  for (const chunk of chunks) {
    for (const module of chunk.modules ?? []) {
      if (module.modules) continue // concatenated parent, children are counted
      const key = packageOf(module.name ?? '')
      bySource.set(key, (bySource.get(key) ?? 0) + (module.size ?? 0))
    }
  }

  const ranked = [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 25)
  for (const [source, size] of ranked) {
    const share = totalSize > 0 ? (size / totalSize) * 100 : 0
    const bar = '█'.repeat(Math.max(1, Math.round(share / 2)))
    console.log(
      `${kb(size).padStart(11)}  ${share.toFixed(1).padStart(5)}%  ${bar} ${source}`
    )
  }
}

const chunks = stats.chunks ?? []
report(
  'ENTRY (downloaded by every visitor)',
  chunks.filter((c) => c.initial)
)

const asyncChunks = chunks
  .filter((c) => !c.initial)
  .sort((a, b) => b.size - a.size)
console.log(`\nLARGEST ASYNC CHUNKS  (${asyncChunks.length} total)`)
console.log('─'.repeat(64))
for (const chunk of asyncChunks.slice(0, 15)) {
  const label = chunk.names?.[0] || chunk.files?.[0] || chunk.id
  console.log(`${kb(chunk.size).padStart(11)}  ${label}`)
}

const entryBytes = chunks
  .filter((c) => c.initial)
  .reduce((sum, chunk) => sum + chunk.size, 0)
console.log(`\nENTRY TOTAL: ${kb(entryBytes)} (uncompressed)`)
