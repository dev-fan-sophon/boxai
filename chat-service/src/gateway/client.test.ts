import { afterEach, describe, expect, test } from 'bun:test'

import { billedRelayFetch } from './client'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('billedRelayFetch', () => {
  test('authenticates the acted-as user and forces the selected group', async () => {
    process.env.INTERNAL_SERVICE_SECRET = 'internal-test-secret'
    let captured: RequestInit | undefined
    const mocked = Object.assign(
      async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        captured = init
        return new Response('{}', { status: 200 })
      },
      { preconnect: () => {} }
    )
    globalThis.fetch = mocked

    await billedRelayFetch(42, 'premium')('http://gateway.test/pg/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test-model', group: 'wrong' }),
    })

    const headers = new Headers(captured?.headers)
    expect(headers.get('X-BoxAI-Internal-Secret')).toBe('internal-test-secret')
    expect(headers.get('X-BoxAI-Act-As-User')).toBe('42')
    expect(JSON.parse(String(captured?.body))).toEqual({
      model: 'test-model',
      group: 'premium',
    })
  })
})
