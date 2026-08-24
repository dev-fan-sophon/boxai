import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'

import { listManifestPages, resolveDocsLocale } from '../lib/load-doc'

type SearchDocument = {
  id: string
  path: string
  title: string
  summary: string
  section: string
  headings: string
  body: string
}

type SearchIndexFile = {
  locale: string
  documents: SearchDocument[]
}

async function loadSearchIndex(locale: 'en' | 'vi'): Promise<SearchDocument[]> {
  const response = await fetch(`/doc-assets/docs-search.${locale}.json`, {
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(`search index ${response.status}`)
  }
  const data = (await response.json()) as SearchIndexFile
  return data.documents ?? []
}

function scoreDocument(doc: SearchDocument, tokens: string[]): number {
  let score = 0
  const title = doc.title.toLowerCase()
  const summary = doc.summary.toLowerCase()
  const headings = doc.headings.toLowerCase()
  const body = doc.body.toLowerCase()
  for (const token of tokens) {
    if (title.includes(token)) score += 8
    if (summary.includes(token)) score += 4
    if (headings.includes(token)) score += 3
    if (body.includes(token)) score += 1
  }
  return score
}

export function DocSearch() {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const locale = resolveDocsLocale(i18n.language)
  const fallbackPages = listManifestPages()

  const indexQuery = useQuery({
    queryKey: ['docs-search-index', locale],
    queryFn: () => loadSearchIndex(locale),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  })

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const tokens = q.split(/\s+/).filter(Boolean)
    const docs =
      indexQuery.data ??
      fallbackPages.map((page) => ({
        id: page.path,
        path: page.href,
        title: page.title,
        summary: page.summary,
        section: page.section,
        headings: page.headings.map((h) => h.text).join(' '),
        body: '',
      }))
    return docs
      .map((doc) => ({ doc, score: scoreDocument(doc, tokens) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((item) => item.doc)
  }, [fallbackPages, indexQuery.data, query])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'k'
      ) {
        return
      }
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        // still allow focusing docs search when already typing elsewhere? skip
      }
      const docsSearch = document.querySelector<HTMLInputElement>(
        'input[data-docs-search="true"]'
      )
      if (!docsSearch) return
      event.preventDefault()
      docsSearch.focus()
      docsSearch.select()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className='space-y-2'>
      <label className='relative block'>
        <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2' />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('Search documentation')}
          className='pl-9'
          aria-label={t('Search documentation')}
          data-docs-search='true'
        />
      </label>
      <p className='text-muted-foreground px-1 text-[11px]'>
        {t('Press Ctrl/⌘ K to focus search')}
      </p>
      {results.length > 0 && (
        <ul className='rounded-md border p-1 text-sm'>
          {results.map((page) => {
            const splat = page.path.replace(/^\/docs\//, '').replace(/^\//, '')
            return (
              <li key={page.id}>
                <Link
                  to='/docs/$'
                  params={{ _splat: splat }}
                  className='hover:bg-muted block rounded-md px-2 py-1.5'
                  onClick={() => setQuery('')}
                >
                  <span className='font-medium'>{page.title}</span>
                  <span className='text-muted-foreground mt-0.5 line-clamp-1 block text-xs'>
                    {page.summary}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
