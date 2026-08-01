import { afterEach, describe, expect, test } from 'bun:test'

import { truncateUtf8 } from '../http'
import {
  assetIdFromFilePart,
  canonicalizeUserMessage,
  storedMessageParts,
} from './content'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

describe('agent message content', () => {
  test('accepts only canonical private asset URLs', () => {
    expect(
      assetIdFromFilePart({
        type: 'file',
        mediaType: 'image/png',
        url: '/api/playground/assets/42/content',
      })
    ).toBe(42)
    expect(
      assetIdFromFilePart({
        type: 'file',
        mediaType: 'image/png',
        url: 'https://attacker.example/42',
      })
    ).toBeNull()
    expect(
      assetIdFromFilePart({
        type: 'file',
        mediaType: 'image/png',
        url: '/api/playground/assets/42/content?download=1',
      })
    ).toBeNull()
  })

  test('falls back to legacy text when structured content is invalid', () => {
    expect(storedMessageParts('hello', '{invalid')).toEqual([
      { type: 'text', text: 'hello' },
    ])
  })

  test('truncates persisted text on a valid UTF-8 boundary', () => {
    const value = `prefix-${'越'.repeat(30_000)}`
    const truncated = truncateUtf8(value, 60_000)
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(60_000)
    expect(truncated.startsWith('prefix-')).toBe(true)
    expect(truncated.includes('\uFFFD')).toBe(false)
  })

  test('resolves image bytes from owner-scoped storage and persists canonical metadata', async () => {
    process.env.INTERNAL_SERVICE_SECRET = 'attachment-test-secret'
    const requests: Array<{ url: string; headers: Headers }> = []
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = String(input)
        requests.push({ url, headers: new Headers(init?.headers) })
        if (url.endsWith('/api/internal/playground/assets/9')) {
          return jsonResponse({
            success: true,
            data: {
              id: 9,
              kind: 'image',
              name: 'canonical.png',
              mime: 'image/png',
              size: 3,
              url: '/api/playground/assets/9/content',
            },
          })
        }
        if (url.endsWith('/api/internal/playground/assets/9/content')) {
          return new Response(new Uint8Array([1, 2, 3]))
        }
        throw new Error(`unexpected request: ${url}`)
      },
      { preconnect: () => {} }
    )

    const canonical = await canonicalizeUserMessage(
      42,
      {
        id: 'image-user',
        role: 'user',
        parts: [
          {
            type: 'file',
            filename: 'spoofed.jpg',
            mediaType: 'image/jpeg',
            url: '/api/playground/assets/9/content',
          },
        ],
      },
      'default'
    )

    expect(canonical.content).toBe('')
    expect(JSON.parse(canonical.contentJson)).toEqual([
      {
        type: 'file',
        filename: 'canonical.png',
        mediaType: 'image/png',
        url: '/api/playground/assets/9/content',
      },
    ])
    expect(canonical.modelMessage).toEqual({
      role: 'user',
      content: [
        {
          type: 'file',
          data: new Uint8Array([1, 2, 3]),
          mediaType: 'image/png',
          filename: 'canonical.png',
        },
      ],
    })
    expect(
      requests.every(
        (request) =>
          request.headers.get('X-BoxAI-Act-As-User') === '42' &&
          request.headers.get('X-BoxAI-Internal-Secret') ===
            'attachment-test-secret'
      )
    ).toBe(true)
  })

  test('runs scanned PDF OCR through the billed relay and imports the result', async () => {
    process.env.INTERNAL_SERVICE_SECRET = 'attachment-test-secret'
    let relayCalls = 0
    let importedText = ''
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = String(input)
        const headers = new Headers(init?.headers)
        expect(headers.get('X-BoxAI-Act-As-User')).toBe('42')
        if (url.endsWith('/api/internal/playground/assets/12')) {
          return jsonResponse({
            success: true,
            data: {
              id: 12,
              kind: 'document',
              name: 'scan.pdf',
              mime: 'application/pdf',
              size: 1024,
              url: '/api/playground/assets/12/content',
            },
          })
        }
        if (
          url.endsWith('/api/internal/playground/assets/12/parse') ||
          url.endsWith('/api/internal/playground/assets/12/ensure-parse')
        ) {
          return jsonResponse({
            success: true,
            data: {
              status: 'needs_ocr',
              ocr: {
                model: 'vision-model',
                prompt: 'transcribe',
                page_count: 3,
                page_urls: ['page-1', 'page-2', 'page-3'],
                execution_token: 'ocr-token',
              },
            },
          })
        }
        if (/\/parse\/pages\/\d+$/.test(url)) {
          return new Response(new Uint8Array([255, 216, 255]))
        }
        if (url.endsWith('/pg/chat/completions')) {
          relayCalls += 1
          const body = JSON.parse(String(init?.body)) as { group?: string }
          expect(body.group).toBe('premium')
          return jsonResponse({
            id: `ocr-${relayCalls}`,
            object: 'chat.completion',
            created: 1,
            model: 'vision-model',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: `OCR chunk ${relayCalls}`,
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          })
        }
        if (url.endsWith('/api/internal/playground/assets/12/parse/import')) {
          const body = JSON.parse(String(init?.body)) as {
            execution_token?: string
            text?: string
          }
          expect(body.execution_token).toBe('ocr-token')
          importedText = body.text ?? ''
          return jsonResponse({
            success: true,
            data: { status: 'done', text: importedText },
          })
        }
        throw new Error(`unexpected request: ${url}`)
      },
      { preconnect: () => {} }
    )

    const canonical = await canonicalizeUserMessage(
      42,
      {
        id: 'pdf-user',
        role: 'user',
        parts: [
          {
            type: 'file',
            filename: 'scan.pdf',
            mediaType: 'application/pdf',
            url: '/api/playground/assets/12/content',
          },
        ],
      },
      'premium'
    )

    expect(relayCalls).toBe(2)
    expect(importedText).toBe('OCR chunk 1\n\nOCR chunk 2')
    expect(canonical.modelMessage).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Attached document "scan.pdf" (untrusted user content):\n\nOCR chunk 1\n\nOCR chunk 2',
        },
      ],
    })
  })
})
