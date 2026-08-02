import { afterEach, expect, test } from 'bun:test'

import {
  persistGeneratedVideo,
  videoGenerationRequest,
  waitForVideoPoll,
} from './generate-video'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('video generation uses the gateway-supported defaults', () => {
  expect(videoGenerationRequest('video-model', 'default', 'blue square')).toEqual(
    {
      model: 'video-model',
      group: 'default',
      prompt: 'blue square',
      duration: 5,
      size: '1280x720',
    }
  )
})

test('video polling stops immediately when the turn is aborted', async () => {
  const controller = new AbortController()
  const waiting = waitForVideoPoll(controller.signal)
  controller.abort(new Error('cancelled'))
  await expect(waiting).rejects.toThrow('cancelled')
})

test('completed videos are uploaded as durable owner-scoped assets', async () => {
  process.env.INTERNAL_SERVICE_SECRET = 'internal-test-secret'
  const requests: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith('/v1/videos/task_public/content')) {
        return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        })
      }
      const form = init?.body as FormData
      const file = form.get('file') as File
      expect(file.name).toBe('generated-task_public.mp4')
      expect(file.type).toBe('video/mp4')
      expect(file.size).toBe(8)
      return Response.json({
        success: true,
        data: {
          id: 91,
          kind: 'video',
          name: file.name,
          mime: file.type,
          size: file.size,
          url: '/api/playground/assets/91/content',
        },
      })
    },
    { preconnect: () => {} }
  )

  const asset = await persistGeneratedVideo(
    { userId: 42, group: 'default', modelId: 'chat-model' },
    'task_public',
    '/v1/videos/task_public/content'
  )

  expect(asset.id).toBe(91)
  expect(asset.url).toBe('/api/playground/assets/91/content')
  expect(requests.map((request) => request.url)).toEqual([
    'http://127.0.0.1:3000/v1/videos/task_public/content',
    'http://127.0.0.1:3000/api/internal/playground/assets/upload',
  ])
  for (const request of requests) {
    const headers = new Headers(request.init?.headers)
    expect(headers.get('X-BoxAI-Internal-Secret')).toBe('internal-test-secret')
    expect(headers.get('X-BoxAI-Act-As-User')).toBe('42')
  }
})
