import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Markdown } from '@/components/ui/markdown'
import { useSeo } from '@/hooks/use-page-seo'
import { cn } from '@/lib/utils'

import { DocFeedback } from './components/doc-feedback'
import { DocPager } from './components/doc-pager'
import { DocToc } from './components/doc-toc'
import { DocsShell } from './docs-shell'
import {
  adjacentDocsPages,
  loadDocsPage,
  normalizeDocsPath,
} from './lib/load-doc'

function enhanceHeadingIds(container: HTMLElement) {
  const used = new Set<string>()
  for (const heading of container.querySelectorAll('h2, h3')) {
    const text = heading.textContent?.trim() || ''
    if (!text) continue
    const id =
      heading.id ||
      text
        .toLowerCase()
        .normalize('NFKD')
        .replaceAll(/[\u0300-\u036f]/g, '')
        .replaceAll(/[^a-z0-9\s-]/g, '')
        .trim()
        .replaceAll(/\s+/g, '-')
        .replaceAll(/-+/g, '-')
    if (!id) continue
    let unique = id
    let i = 2
    while (used.has(unique)) {
      unique = `${id}-${i}`
      i += 1
    }
    used.add(unique)
    heading.id = unique
  }
}

export function DocsArticlePage(props: { docPath: string }) {
  const { t, i18n } = useTranslation()
  const path = normalizeDocsPath(props.docPath)
  const loaded = loadDocsPage(path, i18n.language)
  const pager = adjacentDocsPages(path)
  const bodyRef = useRef<HTMLDivElement>(null)

  useSeo(
    useMemo(() => {
      if (!loaded) {
        return {
          title: t('Documentation page not found'),
          description: t(
            'The requested documentation page does not exist or is no longer available.'
          ),
        }
      }
      return {
        title: loaded.page.title,
        description: loaded.page.summary,
      }
    }, [loaded, t])
  )

  useEffect(() => {
    if (bodyRef.current) enhanceHeadingIds(bodyRef.current)
  }, [loaded?.page.body, loaded?.page.path])

  if (!loaded) {
    return null
  }

  const { page, fellBackToEn } = loaded

  return (
    <DocsShell activePath={path} toc={<DocToc headings={page.headings} />}>
      <h1 className='text-3xl font-bold tracking-tight'>{page.title}</h1>
      <p className='text-muted-foreground mt-3 text-lg'>{page.summary}</p>
      {page.updated ? (
        <p className='text-muted-foreground mt-2 text-xs'>
          {t('Updated')} {page.updated}
        </p>
      ) : null}
      {fellBackToEn ? (
        <div className='bg-muted mt-4 rounded-lg border px-3 py-2 text-sm'>
          {t('This page is not fully translated yet. Showing English.')}
        </div>
      ) : null}
      <div ref={bodyRef} id='docs-article-body'>
        <Markdown
          className={cn(
            'mt-8',
            '[&_.doc-callout]:my-4 [&_.doc-callout]:rounded-lg [&_.doc-callout]:border [&_.doc-callout]:px-4 [&_.doc-callout]:py-3',
            '[&_.doc-callout-warning]:border-warning/40 [&_.doc-callout-warning]:bg-warning/10',
            '[&_.doc-callout-danger]:border-destructive/40 [&_.doc-callout-danger]:bg-destructive/10',
            '[&_.doc-callout-info]:bg-muted/40',
            '[&_.doc-callout-tip]:border-primary/30 [&_.doc-callout-tip]:bg-primary/5',
            '[&_.doc-steps]:my-4',
            '[&_.doc-figure]:my-6 [&_.doc-figure_img]:rounded-xl [&_.doc-figure_img]:border',
            '[&_.doc-figure_figcaption]:text-muted-foreground [&_.doc-figure_figcaption]:mt-2 [&_.doc-figure_figcaption]:text-sm'
          )}
        >
          {page.body}
        </Markdown>
      </div>
      <DocFeedback docPath={path} />
      <DocPager prev={pager.prev} next={pager.next} />
    </DocsShell>
  )
}
