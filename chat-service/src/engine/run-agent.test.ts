import { afterEach, describe, expect, spyOn, test } from 'bun:test'

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

  test('moves context system messages into AI SDK instructions', async () => {
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
      system: 'platform instructions',
      messages: [
        { role: 'system', content: 'conversation summary' },
        { role: 'user', content: 'hello' },
      ],
    })
    await result.consumeStream()

    expect(requestBody).toMatchObject({
      messages: [
        { role: 'system', content: 'platform instructions' },
        { role: 'system', content: 'conversation summary' },
        { role: 'user', content: 'hello' },
      ],
    })
  })
})

describe('agent deadlines', () => {
  for (const ending of ['complete', 'timeout', 'stop'] as const) {
    test(`slow stream survives 180 seconds then ${ending}`, async () => {
      process.env.INTERNAL_SERVICE_SECRET = 'internal-test-secret'
      const timers = new Map<number, { at: number; fire: () => void }>()
      let now = 0
      let timerId = 100000
      const realSetTimeout = globalThis.setTimeout
      const realClearTimeout = globalThis.clearTimeout
      const timerSpy = spyOn(globalThis, 'setTimeout').mockImplementation(
        ((callback: () => void, ms: number, ...args: unknown[]) => {
          if (ms < 180_000) return realSetTimeout(callback, ms, ...args)
          const id = ++timerId
          timers.set(id, { at: now + ms, fire: callback })
          return id
        }) as typeof setTimeout
      )
      const clearSpy = spyOn(globalThis, 'clearTimeout').mockImplementation(
        ((id: number) => {
          if (!timers.delete(Number(id))) realClearTimeout(id)
        }) as typeof clearTimeout
      )
      const advance = (ms: number) => {
        now += ms
        for (const [id, timer] of timers) {
          if (timer.at > now) continue
          timers.delete(id)
          timer.fire()
        }
      }
      const caller = new AbortController()
      let transportSignal: AbortSignal | undefined
      let body!: ReadableStreamDefaultController<Uint8Array>
      const fetched = Promise.withResolvers<void>()
      const encoder = new TextEncoder()
      globalThis.fetch = Object.assign(
        async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          transportSignal = init?.signal ?? undefined
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              body = controller
              transportSignal?.addEventListener('abort', () => {
                controller.error(new DOMException('The operation was aborted', 'AbortError'))
              }, { once: true })
            },
          })
          fetched.resolve()
          return new Response(stream, {
            headers: { 'content-type': 'text/event-stream' },
          })
        },
        { preconnect: () => {} }
      )
      try {
        const errors: unknown[] = []
        let aborted: boolean | undefined
        const result = await runAgent({
          userId: 7,
          modelId: 'slow-model',
          group: 'default',
          messages: [{ role: 'user', content: 'hello' }],
          abortSignal: caller.signal,
          onError: (error) => { errors.push(error) },
        })
        const chunksPromise = Array.fromAsync(result.toUIMessageStream({
          onError: (error) => (error as Error).message,
          onEnd: (event) => { aborted = event.isAborted },
        }))
        await fetched.promise
        advance(180_001)
        expect(transportSignal?.aborted).toBe(false)
        expect(errors).toEqual([])
        if (ending === 'complete') {
          body.enqueue(encoder.encode([
            'data: {"choices":[{"index":0,"delta":{"content":"late answer"},"finish_reason":null}]}',
            'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
            'data: [DONE]',
            '',
          ].join('\n\n')))
          body.close()
        } else if (ending === 'timeout') {
          advance(419_998)
          expect(transportSignal?.aborted).toBe(false)
          advance(1)
        } else {
          caller.abort(new Error('generation stopped by user'))
        }
        const chunks = await chunksPromise
        expect(aborted).toBe(ending === 'stop')
        if (ending === 'timeout') {
          expect(transportSignal?.aborted).toBe(true)
          expect(caller.signal.aborted).toBe(false)
          expect(errors).toHaveLength(1)
          expect(chunks).toContainEqual({
            type: 'error',
            errorText: (errors[0] as Error).message,
          })
          expect((errors[0] as Error).message).toContain('canceled locally')
        } else {
          expect(errors).toEqual([])
          expect(chunks.some((chunk) => chunk.type === 'error')).toBe(false)
          if (ending === 'complete') {
            expect(chunks).toContainEqual(expect.objectContaining({
              type: 'text-delta', delta: 'late answer',
            }))
          } else {
            expect(transportSignal?.aborted).toBe(true)
          }
        }
      } finally {
        timerSpy.mockRestore()
        clearSpy.mockRestore()
      }
    })
  }
})
