import { beforeEach, describe, expect, it, vi } from 'vitest'

const post = vi.fn()

vi.mock('@/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => post(...args),
  },
}))

import { uploadPlaygroundAsset } from './api'

describe('uploadPlaygroundAsset', () => {
  beforeEach(() => {
    post.mockReset()
    vi.unstubAllGlobals()
  })

  it('puts the file to the signed URL and does not send it to the API', async () => {
    post.mockResolvedValue({
      data: {
        success: true,
        data: {
          put_url: 'https://r2.example/uploads/ref.mp4?sig=1',
          asset: { id: 9, kind: 'image', url: '/api/playground/assets/9/content' },
        },
      },
    })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['pixels'], 'ref.png', { type: 'image/png' })

    const asset = await uploadPlaygroundAsset(file, 'image', 'library')

    expect(asset.id).toBe(9)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0]?.[0]).toBe('/api/playground/assets/upload-intent')
    const body = post.mock.calls[0]?.[1] as { size: number; kind: string }
    expect(body.size).toBe(file.size)
    expect(body.kind).toBe('image')
    expect(JSON.stringify(body)).not.toContain('pixels')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://r2.example/uploads/ref.mp4?sig=1',
      expect.objectContaining({ method: 'PUT', body: file })
    )
  })

  it('falls back to multipart when direct upload is unavailable', async () => {
    post
      .mockResolvedValueOnce({ data: { success: false, message: 'direct upload is not available' } })
      .mockResolvedValueOnce({
        data: { success: true, data: { id: 3, kind: 'video', url: '/api/playground/assets/3/content' } },
      })
    const file = new File(['clip'], 'clip.mp4', { type: 'video/mp4' })

    const asset = await uploadPlaygroundAsset(file, 'video')

    expect(asset.id).toBe(3)
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1]?.[0]).toBe('/api/playground/assets')
  })
})
