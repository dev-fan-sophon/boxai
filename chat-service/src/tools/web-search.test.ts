import { afterEach, expect, test } from 'bun:test'

import { tavilySearch } from './web-search'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('Tavily fast search returns bounded safe excerpts and sources', async () => {
  process.env.TAVILY_API_KEY = 'test-tavily-key'
  let captured: RequestInit | undefined
  globalThis.fetch = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      captured = init
      return Response.json({
        results: [
          {
            title: ' Current result ',
            url: 'https://example.com/news#latest',
            content: 'Relevant current information.',
          },
          {
            title: 'Unsafe result',
            url: 'javascript:alert(1)',
            content: 'Must not be returned.',
          },
        ],
      })
    },
    { preconnect: () => {} }
  )

  const result = await tavilySearch('latest news')

  const headers = new Headers(captured?.headers)
  expect(headers.get('Authorization')).toBe('Bearer test-tavily-key')
  expect(JSON.parse(String(captured?.body))).toEqual({
    query: 'latest news',
    search_depth: 'basic',
    max_results: 8,
    include_answer: false,
    include_raw_content: false,
  })
  expect(result).toEqual({
    text: '1. Current result\nURL: https://example.com/news#latest\nRelevant current information.',
    sources: [
      {
        href: 'https://example.com/news#latest',
        title: 'Current result',
        domain: 'example.com',
      },
    ],
  })
})
