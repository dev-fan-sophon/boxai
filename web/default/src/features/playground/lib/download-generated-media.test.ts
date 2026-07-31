import { describe, expect, it } from 'vitest'

import { generatedMediaExtension } from './download-generated-media'

describe('generatedMediaExtension', () => {
  it.each([
    ['video/quicktime', 'video', 'mov'],
    ['video/webm', 'video', 'webm'],
    ['audio/webm', 'audio', 'webm'],
    ['audio/mp4', 'audio', 'm4a'],
    ['audio/m4a', 'audio', 'm4a'],
    ['application/octet-stream', 'image', 'png'],
    ['', 'video', 'mp4'],
  ] as const)('maps %s %s to .%s', (mimeType, kind, extension) => {
    expect(generatedMediaExtension(mimeType, kind)).toBe(extension)
  })
})

describe('same-origin download URL patterns', () => {
  // Keep in sync with SAME_ORIGIN_DOWNLOADABLE in download-generated-media.ts
  const pattern =
    /(?:\/api\/playground\/assets\/\d+\/content|\/v1\/videos\/[^/?#]+\/content)(?:\?|$)/

  it.each([
    '/api/playground/assets/12/content',
    '/api/playground/assets/12/content?x=1',
    '/v1/videos/task_abc/content',
    '/v1/videos/task_abc/content?download=1',
  ])('matches %s', (url) => {
    expect(pattern.test(url)).toBe(true)
  })

  it.each([
    'https://cdn.example/image.png',
    '/api/playground/assets/x/content',
    '/v1/videos//content',
  ])('rejects %s', (url) => {
    expect(pattern.test(url)).toBe(false)
  })
})
