#!/usr/bin/env node
/**
 * Compile product docs Markdown into runtime JSON + public manifests.
 * See docs/product-docs-system.md.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { JSON_SCHEMA, load as parseYaml } from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, '../..')
const contentRoot = path.join(webRoot, 'content/docs')
const generatedDir = path.join(webRoot, 'src/features/docs/generated')
const publicDocsDir = path.join(webRoot, 'public/doc-assets')

const LOCALES = ['en', 'vi']

const CORE_PATHS = [
  'start/what-is-boxai',
  'start/getting-started',
  'start/first-request',
  'console/api-keys',
  'console/model-hub',
  'console/billing-topup',
  'console/usage-logs',
  'api/overview',
  'api/auth',
  'api/streaming',
  'api/errors',
  'clients/desktop',
  'playground/overview',
  'concepts/models-groups-quota',
]

function fail(message) {
  console.error(`[docs:build] ${message}`)
  process.exit(1)
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function walkMarkdown(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkMarkdown(full))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

function parseFrontmatter(source, sourceName) {
  if (!source.startsWith('---\n') && source !== '---') {
    return { data: {}, body: source }
  }
  const end = source.indexOf('\n---\n', 4)
  if (end === -1) {
    return { data: {}, body: source }
  }
  const fm = source.slice(4, end)
  const body = source.slice(end + 5)
  let data
  try {
    data = parseYaml(fm, { schema: JSON_SCHEMA })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    fail(`${sourceName} invalid frontmatter: ${detail}`)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail(`${sourceName} frontmatter must be a mapping`)
  }
  return { data, body }
}

function slugifyHeading(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll(/[^a-z0-9\s-]/g, '')
    .trim()
    .replaceAll(/\s+/g, '-')
    .replaceAll(/-+/g, '-')
}

function extractHeadings(markdown) {
  const headings = []
  for (const line of markdown.split('\n')) {
    const match = /^(#{2,3})\s+(.+)$/.exec(line.trim())
    if (!match) continue
    const text = match[2].replace(/#+\s*$/, '').trim()
    headings.push({
      id: slugifyHeading(text),
      text,
      level: match[1].length,
    })
  }
  return headings
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function preprocessBody(markdown) {
  let body = markdown.replaceAll('\r\n', '\n')

  // :::callout type="warning" ... :::
  body = body.replaceAll(
    /:::callout(?:\s+type="([a-z]+)")?\s*\n([\s\S]*?)\n[ \t]*:::[ \t]*(?=\n|$)/g,
    (_full, type, content) => {
      const kind = type || 'info'
      const html = content
        .trim()
        .split('\n')
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')
      return `\n\n<div class="doc-callout doc-callout-${kind}" data-callout="${kind}">${html}</div>\n\n`
    }
  )

  // :::steps ... :::  → keep inner markdown list, wrap for styling
  body = body.replaceAll(
    /:::steps\s*\n([\s\S]*?)\n[ \t]*:::[ \t]*(?=\n|$)/g,
    (_full, content) =>
      `\n\n<div class="doc-steps" data-doc-steps="true">\n\n${content.trim()}\n\n</div>\n\n`
  )

  // Images with title → figure + caption (title attribute)
  body = body.replaceAll(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+(?:"([^"]*)"|'([^']*)'))?\)/g,
    (_full, alt, src, doubleTitle, singleTitle) => {
      const title = doubleTitle || singleTitle
      const caption = title || alt
      const captionHtml = caption
        ? `<figcaption>${escapeHtml(caption)}</figcaption>`
        : ''
      return `\n\n<figure class="doc-figure"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />${captionHtml}</figure>\n\n`
    }
  )

  return `${body.trim()}\n`
}

function plainText(markdown) {
  return markdown
    .replaceAll(/```[\s\S]*?```/g, ' ')
    .replaceAll(/`[^`]+`/g, ' ')
    .replaceAll(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replaceAll(/\[[^\]]*\]\([^)]+\)/g, ' ')
    .replaceAll(/<\/?[^>]+>/g, ' ')
    .replaceAll(/[#>*_-]+/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

function relPathToDocPath(localeRoot, filePath) {
  const rel = path.relative(localeRoot, filePath).replaceAll(path.sep, '/')
  if (!rel.endsWith('.md')) {
    fail(`expected markdown file: ${filePath}`)
  }
  return rel.slice(0, -3)
}

function loadPages() {
  /** @type {Record<string, Record<string, object>>} */
  const byLocale = {}
  for (const locale of LOCALES) {
    const localeRoot = path.join(contentRoot, locale)
    byLocale[locale] = {}
    for (const filePath of walkMarkdown(localeRoot)) {
      const docPath = relPathToDocPath(localeRoot, filePath)
      const raw = fs.readFileSync(filePath, 'utf8')
      const { data, body: rawBody } = parseFrontmatter(
        raw,
        `${locale}/${docPath}.md`
      )
      const required = ['title', 'summary', 'section', 'order']
      for (const key of required) {
        if (data[key] === undefined || data[key] === '') {
          fail(`${locale}/${docPath}.md missing frontmatter "${key}"`)
        }
      }
      const status = data.status || 'published'
      if (status !== 'published' && status !== 'draft') {
        fail(`${locale}/${docPath}.md invalid status "${status}"`)
      }
      const body = preprocessBody(rawBody)
      const headings = extractHeadings(rawBody)
      byLocale[locale][docPath] = {
        path: docPath,
        locale,
        title: String(data.title),
        summary: String(data.summary),
        section: String(data.section),
        order: Number(data.order),
        audience: Array.isArray(data.audience)
          ? data.audience.map(String)
          : ['user'],
        updated: data.updated ? String(data.updated) : '',
        status,
        ogImage: data.og_image ? String(data.og_image) : '',
        noindex: Boolean(data.noindex),
        checklist: Array.isArray(data.checklist)
          ? data.checklist.map(String)
          : [],
        headings,
        body,
        plain: plainText(rawBody),
        sourceFile: path.relative(webRoot, filePath).replaceAll(path.sep, '/'),
      }
    }
  }
  return byLocale
}

const SECTION_ORDER = [
  'start',
  'console',
  'api',
  'clients',
  'playground',
  'concepts',
  'admin',
]

function sectionRank(section) {
  const index = SECTION_ORDER.indexOf(section)
  return index === -1 ? 999 : index
}

function buildManifest(byLocale, pagesPayload) {
  const enPages = byLocale.en || {}
  const pages = Object.values(enPages)
    .filter((page) => page.status === 'published')
    .sort((a, b) => {
      const sectionDiff = sectionRank(a.section) - sectionRank(b.section)
      if (sectionDiff !== 0) return sectionDiff
      if (a.order !== b.order) return a.order - b.order
      return a.path.localeCompare(b.path)
    })
    .map((page) => {
      const vi = byLocale.vi?.[page.path]
      return {
        path: page.path,
        href: `/docs/${page.path}`,
        locale: 'en',
        title: page.title,
        summary: page.summary,
        section: page.section,
        order: page.order,
        audience: page.audience,
        updated: page.updated,
        headings: page.headings,
        has_vi: Boolean(vi && vi.status === 'published'),
        og_image: page.ogImage || undefined,
        noindex: page.noindex || undefined,
      }
    })
  let generatedAt = new Date().toISOString()
  const previousManifestPath = path.join(generatedDir, 'manifest.json')
  const previousPagesPath = path.join(generatedDir, 'pages.json')
  if (fs.existsSync(previousManifestPath) && fs.existsSync(previousPagesPath)) {
    try {
      const previous = JSON.parse(fs.readFileSync(previousManifestPath, 'utf8'))
      const previousPages = JSON.parse(
        fs.readFileSync(previousPagesPath, 'utf8')
      )
      if (
        typeof previous.generatedAt === 'string' &&
        previous.version === 1 &&
        JSON.stringify(previous.pages) === JSON.stringify(pages) &&
        JSON.stringify(previousPages) === JSON.stringify(pagesPayload)
      ) {
        generatedAt = previous.generatedAt
      }
    } catch {
      // Invalid generated output is replaced below.
    }
  }
  return {
    generatedAt,
    version: 1,
    pages,
  }
}

function buildSearchIndex(byLocale, locale) {
  const pages = Object.values(byLocale[locale] || {}).filter(
    (page) => page.status === 'published'
  )
  return {
    locale,
    documents: pages.map((page) => ({
      id: page.path,
      path: `/docs/${page.path}`,
      title: page.title,
      summary: page.summary,
      section: page.section,
      headings: page.headings.map((h) => h.text).join(' '),
      body: page.plain,
    })),
  }
}

function validate(byLocale) {
  const en = byLocale.en || {}
  const vi = byLocale.vi || {}
  const errors = []

  for (const core of CORE_PATHS) {
    if (!en[core] || en[core].status !== 'published') {
      errors.push(`missing published en core page: ${core}`)
    }
    if (!vi[core] || vi[core].status !== 'published') {
      errors.push(`missing published vi core page: ${core}`)
    }
  }

  for (const locale of LOCALES) {
    const paths = new Set()
    for (const page of Object.values(byLocale[locale] || {})) {
      if (paths.has(page.path)) {
        errors.push(`duplicate path ${locale}/${page.path}`)
      }
      paths.add(page.path)
      if (!/^[a-z0-9]+(?:\/[a-z0-9-]+)+$/.test(page.path)) {
        errors.push(`invalid path shape ${locale}/${page.path}`)
      }
    }
  }

  if (errors.length) {
    fail(`validation failed:\n- ${errors.join('\n- ')}`)
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function main() {
  if (!fs.existsSync(contentRoot)) {
    fail(`content root missing: ${contentRoot}`)
  }

  const byLocale = loadPages()
  validate(byLocale)

  const pagesPayload = {}
  for (const locale of LOCALES) {
    pagesPayload[locale] = {}
    for (const [docPath, page] of Object.entries(byLocale[locale] || {})) {
      pagesPayload[locale][docPath] = {
        path: page.path,
        locale: page.locale,
        title: page.title,
        summary: page.summary,
        section: page.section,
        order: page.order,
        audience: page.audience,
        updated: page.updated,
        status: page.status,
        ogImage: page.ogImage,
        noindex: page.noindex,
        checklist: page.checklist,
        headings: page.headings,
        body: page.body,
      }
    }
  }

  const manifest = buildManifest(byLocale, pagesPayload)

  ensureDir(generatedDir)
  ensureDir(publicDocsDir)

  writeJson(path.join(generatedDir, 'pages.json'), pagesPayload)
  writeJson(path.join(generatedDir, 'manifest.json'), manifest)
  writeJson(path.join(publicDocsDir, 'docs-manifest.json'), manifest)
  writeJson(
    path.join(publicDocsDir, 'docs-search.en.json'),
    buildSearchIndex(byLocale, 'en')
  )
  writeJson(
    path.join(publicDocsDir, 'docs-search.vi.json'),
    buildSearchIndex(byLocale, 'vi')
  )

  const llmsLines = [
    '# BoxAI Documentation',
    '',
    '> Unified AI API gateway at https://you-box.com',
    '',
    '## Core pages',
    '',
    ...manifest.pages.map(
      (page) =>
        `- [${page.title}](https://you-box.com${page.href}): ${page.summary}`
    ),
    '',
  ]
  fs.writeFileSync(
    path.join(publicDocsDir, 'llms.txt'),
    llmsLines.join('\n'),
    'utf8'
  )

  // Keep generated modules importable without JSON assert edge cases.
  fs.writeFileSync(
    path.join(generatedDir, 'index.ts'),
    `/* eslint-disable */
// Generated by scripts/docs/build-content.mjs — do not edit by hand.
import manifestJson from './manifest.json'
import pagesJson from './pages.json'

export type DocsHeading = {
  id: string
  text: string
  level: number
}

export type DocsCompiledPage = {
  path: string
  locale: string
  title: string
  summary: string
  section: string
  order: number
  audience: string[]
  updated: string
  status: string
  ogImage: string
  noindex: boolean
  checklist: string[]
  headings: DocsHeading[]
  body: string
}

export type DocsManifestPage = {
  path: string
  href: string
  locale: string
  title: string
  summary: string
  section: string
  order: number
  audience: string[]
  updated: string
  headings: DocsHeading[]
  has_vi: boolean
  og_image?: string
  noindex?: boolean
}

export type DocsManifest = {
  generatedAt: string
  version: number
  pages: DocsManifestPage[]
}

export const docsPages = pagesJson as Record<
  string,
  Record<string, DocsCompiledPage>
>
export const docsManifest = manifestJson as DocsManifest
`,
    'utf8'
  )

  console.log(
    `[docs:build] ok — ${manifest.pages.length} published en pages, locales=${LOCALES.join(',')}`
  )
}

main()
