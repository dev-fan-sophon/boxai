import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

type CompiledPage = {
  checklist: string[]
  body: string
}

type CompiledPages = Record<string, Record<string, CompiledPage>>

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
)
const buildScript = path.join(webRoot, 'scripts/docs/build-content.mjs')
const manifestPath = path.join(
  webRoot,
  'src/features/docs/generated/manifest.json'
)
const publicManifestPath = path.join(
  webRoot,
  'public/doc-assets/docs-manifest.json'
)
const pagesPath = path.join(webRoot, 'src/features/docs/generated/pages.json')

function buildDocs(): void {
  execFileSync(process.execPath, [buildScript], { cwd: webRoot })
}

it('compiles formatted docs without losing metadata or custom blocks', () => {
  buildDocs()

  const firstManifest = fs.readFileSync(manifestPath, 'utf8')
  const firstPages = fs.readFileSync(pagesPath, 'utf8')
  const pages = JSON.parse(firstPages) as CompiledPages
  const firstRequest = pages.en?.['start/first-request']
  const desktopVi = pages.vi?.['clients/desktop']

  expect(firstRequest?.checklist).toEqual([
    'Open Playground or prepare curl',
    'Select a model',
    'Send Hello',
    'Confirm 200 or visible reply',
  ])
  expect(firstRequest?.body).toContain('<figure class="doc-figure">')
  expect(firstRequest?.body).toContain('class="doc-steps"')
  expect(firstRequest?.body).not.toMatch(/:::steps|!\[/)
  expect(desktopVi?.body.match(/class="doc-steps"/g)).toHaveLength(2)
  expect(fs.readFileSync(publicManifestPath, 'utf8')).toBe(firstManifest)

  buildDocs()

  expect(fs.readFileSync(manifestPath, 'utf8')).toBe(firstManifest)
  expect(fs.readFileSync(publicManifestPath, 'utf8')).toBe(firstManifest)
  expect(fs.readFileSync(pagesPath, 'utf8')).toBe(firstPages)
})
