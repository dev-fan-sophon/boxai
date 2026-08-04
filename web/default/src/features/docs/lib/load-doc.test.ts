import { describe, expect, it } from 'vitest'

import {
  adjacentDocsPages,
  listManifestPages,
  loadDocsPage,
  normalizeDocsPath,
  resolveDocsLocale,
} from './load-doc'
import { resolveDocsLegacyPath } from './redirects'

describe('docs path helpers', () => {
  it('normalizes slashes', () => {
    expect(normalizeDocsPath('/start/getting-started/')).toBe(
      'start/getting-started'
    )
  })

  it('redirects legacy flat slugs', () => {
    expect(resolveDocsLegacyPath('getting-started')).toBe(
      'start/getting-started'
    )
    expect(resolveDocsLegacyPath('streaming')).toBe('api/streaming')
    expect(resolveDocsLegacyPath('start/getting-started')).toBeNull()
  })

  it('resolves vi locale and loads published pages', () => {
    expect(resolveDocsLocale('vi-VN')).toBe('vi')
    const en = loadDocsPage('start/getting-started', 'en')
    expect(en?.page.title).toMatch(/Getting started/i)
    expect(en?.fellBackToEn).toBe(false)
    const vi = loadDocsPage('start/getting-started', 'vi')
    expect(vi?.locale).toBe('vi')
    expect(vi?.page.title.length).toBeGreaterThan(0)
  })

  it('lists core manifest pages and adjacency', () => {
    const pages = listManifestPages()
    expect(pages.length).toBeGreaterThanOrEqual(14)
    expect(pages.some((p) => p.path === 'console/api-keys')).toBe(true)
    const { prev, next } = adjacentDocsPages('start/getting-started')
    expect(prev || next).toBeTruthy()
  })
})
