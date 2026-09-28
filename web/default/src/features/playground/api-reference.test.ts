import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { generateImages, resolveMediaForUpstream } from './api'
import { DEFAULT_STUDIO_SETTINGS } from './lib/storage/store-migration'

vi.mock('@/lib/api', () => ({ api: { post: vi.fn() } }))

beforeEach(() => vi.clearAllMocks())

it('uses base64 when the provider also returns an empty image URL', async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: { data: [{ url: '', b64_json: 'aW1hZ2U=' }] },
  })
  await expect(
    generateImages({
      model: 'gpt-image-2',
      group: 'default',
      prompt: 'cup',
      settings: DEFAULT_STUDIO_SETTINGS,
    })
  ).resolves.toEqual([
    { url: 'data:image/png;base64,aW1hZ2U=', revisedPrompt: undefined },
  ])
})

describe('provider media references', () => {
  it('exchanges a private asset path for a signed URL without fetching bytes', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        success: true,
        data: { url: 'https://storage.example/signed?token=abc' },
      },
    })
    await expect(
      resolveMediaForUpstream('/api/playground/assets/42/content')
    ).resolves.toBe('https://storage.example/signed?token=abc')
    expect(api.post).toHaveBeenCalledExactlyOnceWith(
      '/api/playground/assets/42/reference'
    )
  })

  it.each([
    'data:image/png;base64,abc',
    'asset://42',
    'https://cdn.example/api/playground/assets/42/content',
    '/api/playground/assets/42/content?download=1',
    '/api/playground/assets/42/content/other',
    '/other/image.png',
  ])('leaves %s unchanged', async (value) => {
    await expect(resolveMediaForUpstream(value)).resolves.toBe(value)
    expect(api.post).not.toHaveBeenCalled()
  })

  it('does not send a private URL upstream when signing fails', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { success: false, message: 'Reference unavailable' },
    })
    await expect(
      resolveMediaForUpstream('/api/playground/assets/42/content')
    ).rejects.toThrow('Reference unavailable')
  })
})
