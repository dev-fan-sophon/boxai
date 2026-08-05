import { docsManifest, docsPages } from '../generated'
import type { DocsCompiledPage, DocsManifestPage } from './types'

export const REPRESENTATIVE_MODEL = 'YOUR_MODEL_ID'

export function normalizeDocsPath(raw: string): string {
  return raw.replaceAll(/^\/+|\/+$/g, '').replaceAll(/\/+/g, '/')
}

export function listManifestPages(): DocsManifestPage[] {
  return docsManifest.pages
}

export function getManifestPage(docPath: string): DocsManifestPage | undefined {
  const path = normalizeDocsPath(docPath)
  return docsManifest.pages.find((page) => page.path === path)
}

export function resolveDocsLocale(language: string | undefined): 'en' | 'vi' {
  const base = (language || 'en').toLowerCase().split('-')[0]
  return base === 'vi' ? 'vi' : 'en'
}

export function loadDocsPage(
  docPath: string,
  language: string | undefined
): {
  page: DocsCompiledPage
  locale: 'en' | 'vi'
  fellBackToEn: boolean
} | null {
  const path = normalizeDocsPath(docPath)
  const preferred = resolveDocsLocale(language)
  const preferredPage = docsPages[preferred]?.[path]
  if (preferredPage && preferredPage.status === 'published') {
    return { page: preferredPage, locale: preferred, fellBackToEn: false }
  }
  const enPage = docsPages.en?.[path]
  if (enPage && enPage.status === 'published') {
    return {
      page: enPage,
      locale: 'en',
      fellBackToEn: preferred !== 'en',
    }
  }
  return null
}

export function docsNavSections(): Array<{
  section: string
  pages: DocsManifestPage[]
}> {
  const groups = new Map<string, DocsManifestPage[]>()
  for (const page of docsManifest.pages) {
    const list = groups.get(page.section) ?? []
    list.push(page)
    groups.set(page.section, list)
  }
  const sectionOrder = [
    'start',
    'console',
    'api',
    'clients',
    'playground',
    'concepts',
    'admin',
  ]
  return sectionOrder
    .filter((section) => groups.has(section))
    .map((section) => ({
      section,
      pages: [...(groups.get(section) ?? [])].sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order
        return a.path.localeCompare(b.path)
      }),
    }))
}

export function adjacentDocsPages(docPath: string): {
  prev?: DocsManifestPage
  next?: DocsManifestPage
} {
  const path = normalizeDocsPath(docPath)
  const pages = docsManifest.pages
  const index = pages.findIndex((page) => page.path === path)
  if (index === -1) return {}
  return {
    prev: index > 0 ? pages[index - 1] : undefined,
    next: index < pages.length - 1 ? pages[index + 1] : undefined,
  }
}
