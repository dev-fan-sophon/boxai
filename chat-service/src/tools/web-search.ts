import { tool } from 'ai'
import { z } from 'zod'

import { config } from '../config'

type TavilyResult = {
  title?: unknown
  url?: unknown
  content?: unknown
}

type TavilyResponse = {
  results?: unknown
}

export async function tavilySearch(query: string, signal?: AbortSignal) {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.tavilyApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      search_depth: 'basic',
      max_results: 8,
      include_answer: false,
      include_raw_content: false,
    }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    throw new Error(`Tavily search responded ${response.status}`)
  }

  const body = (await response.json()) as TavilyResponse
  const rows = Array.isArray(body.results)
    ? (body.results as TavilyResult[])
    : []
  const sources: Array<{ href: string; title: string; domain: string }> = []
  const excerpts: string[] = []
  for (const row of rows) {
    if (typeof row.url !== 'string') continue
    let url: URL
    try {
      url = new URL(row.url)
    } catch {
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    const title =
      typeof row.title === 'string' && row.title.trim()
        ? row.title.trim().slice(0, 500)
        : url.hostname
    const content =
      typeof row.content === 'string' ? row.content.trim().slice(0, 4000) : ''
    sources.push({ href: url.href, title, domain: url.hostname })
    excerpts.push(
      `${sources.length}. ${title}\nURL: ${url.href}${content ? `\n${content}` : ''}`
    )
  }
  if (sources.length === 0) {
    throw new Error('Tavily search returned no usable results')
  }
  return {
    text: excerpts.join('\n\n'),
    sources,
  }
}

export function webSearchTool() {
  const resultsByQuery = new Map<string, ReturnType<typeof tavilySearch>>()
  return tool({
    description:
      'Quickly search the live web for current information, facts, and sources. ' +
      'Use this for normal web lookups. Returns relevant excerpts and source links.',
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .max(2000)
        .describe('The search query, in the language of the expected sources'),
    }),
    execute: async ({ query }, options) => {
      const normalized = query.trim()
      let result = resultsByQuery.get(normalized)
      if (!result) {
        result = tavilySearch(normalized, options?.abortSignal)
        resultsByQuery.set(normalized, result)
      }
      return result
    },
  })
}
