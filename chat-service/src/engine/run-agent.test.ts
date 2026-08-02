import { afterEach, describe, expect, test } from 'bun:test'

import { runAgent } from './run-agent'

const originalFetch = globalThis.fetch
const originalInternalSecret = process.env.INTERNAL_SERVICE_SECRET

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalInternalSecret === undefined) {
    delete process.env.INTERNAL_SERVICE_SECRET
  } else {
    process.env.INTERNAL_SERVICE_SECRET = originalInternalSecret
  }
})

describe('agent reasoning options', () => {
  test('sends an explicit none effort through the compatible provider', async () => {
    process.env.INTERNAL_SERVICE_SECRET = 'internal-test-secret'
    let requestBody: unknown
    globalThis.fetch = Object.assign(
      async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as unknown
        return new Response(
          [
            'data: {"id":"response-1","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}',
            'data: {"id":"response-1","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
            'data: [DONE]',
            '',
          ].join('\n\n'),
          { headers: { 'content-type': 'text/event-stream' } }
        )
      },
      { preconnect: () => {} }
    )

    const result = await runAgent({
      userId: 7,
      modelId: 'test-model',
      group: 'default',
      messages: [{ role: 'user', content: 'hello' }],
      reasoning: 'none',
    })
    await result.consumeStream()
    expect(requestBody).toMatchObject({ reasoning_effort: 'none' })
  })
})
