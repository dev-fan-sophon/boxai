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
