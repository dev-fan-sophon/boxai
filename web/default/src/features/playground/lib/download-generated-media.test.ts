import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { importPlaygroundAsset, uploadPlaygroundAsset } from '../api'
import {
  downloadGeneratedMedia,
  fetchGeneratedMedia,
  generatedMediaExtension,
  retryGeneratedImage,
} from './download-generated-media'

vi.mock('@/lib/api', () => ({
  getCommonHeaders: () => ({
    'New-Api-User': '42',
    'Content-Type': 'application/json',
  }),
}))
vi.mock('../api', () => ({
  importPlaygroundAsset: vi.fn(),
  uploadPlaygroundAsset: vi.fn(),
}))

beforeEach(() => {
  vi.stubGlobal('window', {
    location: new URL('https://you-box.com/playground'),
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

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

describe('media downloads', () => {
  it.each([
    'https://cdn.example/api/playground/assets/12/content',
    '//cdn.example/api/private',
    'https://cdn.example/v1/videos/task/content',
  ])('never sends app credentials to %s', async (url) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('image'))
    vi.stubGlobal('fetch', fetchMock)
    await fetchGeneratedMedia(url)
    expect(fetchMock).toHaveBeenCalledWith(url, {
      credentials: 'omit',
      headers: undefined,
      redirect: 'follow',
    })
  })

  it('authenticates private streams without forwarding headers on redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('image'))
    vi.stubGlobal('fetch', fetchMock)
    await fetchGeneratedMedia('/api/playground/assets/12/content')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playground/assets/12/content?download=1',
      {
        credentials: 'same-origin',
        headers: { 'New-Api-User': '42' },
        redirect: 'error',
      }
    )
  })

  it.each([false, true])(
    'downloads without imports or uploads (CORS failure: %s)',
    async (fails) => {
      const fetchMock = vi.fn()
      if (fails) fetchMock.mockRejectedValueOnce(new TypeError('CORS'))
      fetchMock.mockResolvedValue(
        new Response('image', { headers: { 'Content-Type': 'image/png' } })
      )
      vi.stubGlobal('fetch', fetchMock)
      const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
      vi.stubGlobal('document', {
        createElement: () => anchor,
        body: { append: vi.fn() },
      })
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      const source = 'https://cdn.example/image.png?token=a&b=c'
      await downloadGeneratedMedia(source, 'image', 'image')
      expect(fetchMock).toHaveBeenCalledTimes(fails ? 2 : 1)
      if (fails) {
        expect(fetchMock.mock.calls[1][0]).toBe(
          `/api/playground/media-proxy?url=${encodeURIComponent(source)}&kind=image`
        )
      }
      expect(importPlaygroundAsset).not.toHaveBeenCalled()
      expect(uploadPlaygroundAsset).not.toHaveBeenCalled()
      expect(anchor.download).toBe('image.png')
      expect(anchor.click).toHaveBeenCalledOnce()
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:download')
    }
  )

  it('retries remote image display only once without storage', () => {
    const image = {
      src: 'https://cdn.example/image.png',
      getAttribute: () => image.src,
    }
    retryGeneratedImage(image as unknown as HTMLImageElement)
    const fallback = image.src
    expect(fallback).toBe(
      '/api/playground/media-proxy?url=https%3A%2F%2Fcdn.example%2Fimage.png&kind=image'
    )
    retryGeneratedImage(image as unknown as HTMLImageElement)
    expect(image.src).toBe(fallback)
    expect(importPlaygroundAsset).not.toHaveBeenCalled()
    expect(uploadPlaygroundAsset).not.toHaveBeenCalled()
  })
})
