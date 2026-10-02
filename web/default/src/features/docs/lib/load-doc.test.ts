import { describe, expect, it } from 'vitest'

import {
  adjacentDocsPages,
  docsNavSections,
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

  it('keeps Connect navigation and pager in Vietnamese without changing URLs', () => {
    const pages = docsNavSections('vi-VN').find(
      (group) => group.section === 'clients'
    )?.pages
    expect(
      pages?.find((page) => page.path === 'clients/connect/install')
    ).toMatchObject({
      title: 'Cài đặt BoxAI Connect',
      href: '/docs/clients/connect/install',
    })
    expect(adjacentDocsPages('clients/connect', 'vi').next?.title).toBe(
      'Cài đặt BoxAI Connect'
    )
    expect(
      listManifestPages('fr').find(
        (page) => page.path === 'clients/connect/install'
      )?.title
    ).toBe('Install BoxAI Connect')
  })

  it('publishes the complete bilingual client journeys with valid guide links', () => {
    const paths = [
      'clients/desktop',
      'clients/desktop/install',
      'clients/desktop/sign-in',
      'clients/desktop/models-and-billing',
      'clients/desktop/projects-and-sessions',
      'clients/desktop/tool-approvals',
      'clients/desktop/extensions',
      'clients/desktop/updates',
      'clients/desktop/troubleshooting',
      'clients/connect',
      'clients/connect/install',
      'clients/connect/sign-in',
      'clients/connect/agents-and-models',
      'clients/connect/gateway-and-routing',
      'clients/connect/account-and-troubleshooting',
    ]
    for (const locale of ['en', 'vi']) {
      for (const path of paths) {
        const loaded = loadDocsPage(path, locale)
        expect(loaded?.locale).toBe(locale)
        expect(loaded?.fellBackToEn).toBe(false)
        if (!loaded) throw new Error(`Missing ${locale} guide: ${path}`)
        for (const match of loaded.page.body.matchAll(
          /\]\(\/docs\/([^\s)#]+)(?:#[^)]*)?\)/g
        )) {
          expect(
            loadDocsPage(match[1], locale),
            `${path} links to ${match[1]}`
          ).not.toBeNull()
        }
      }
    }
  })
})
