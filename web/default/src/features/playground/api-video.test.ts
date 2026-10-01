import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { buildVideoRequestBody, submitVideo } from './api'
import { DEFAULT_STUDIO_SETTINGS } from './lib/storage/store-migration'
import type { VideoModelCapabilities } from './lib/studio/video-capabilities'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  getCommonHeaders: vi.fn(),
}))

const adaptive: VideoModelCapabilities = {
  family: 'seedance-2.5',
  aspectRatios: ['adaptive'],
  resolutions: ['720p'],
  imageOnlyResolutions: [],
  durations: [5],
  durationRange: { min: 5, max: 5 },
  defaults: { aspectRatio: 'adaptive', resolution: '720p', duration: 5 },
  maxReferenceImages: 3,
  supportsLastFrame: true,
  requiresImage: false,
  supportsAudioToggle: false,
  usesVolcengineMetadata: true,
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.post).mockResolvedValue({ data: { id: 'video-task' } })
})

describe('server-authoritative video submission', () => {
  it('submits Grok 1.5 text-to-video at 1080p without image fields', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        success: true,
        data: {
          text: {
            ...adaptive,
            family: 'xai',
            aspectRatios: ['16:9', '9:16'],
            resolutions: ['720p', '1080p'],
            resolutionAspectRatios: { '1080p': ['16:9'] },
            defaults: { aspectRatio: '16:9', resolution: '720p', duration: 5 },
            maxReferenceImages: 0,
            supportsLastFrame: false,
            usesVolcengineMetadata: false,
          },
        },
      },
    })
    const result = await submitVideo({
      model: 'grok-imagine-video-1.5',
      group: 'default',
      prompt: 'A paper boat on a lake',
      settings: DEFAULT_STUDIO_SETTINGS,
      aspectRatio: '16:9',
      resolution: '1080p',
      duration: 5,
    })
    expect(result.taskId).toBe('video-task')
    expect(api.post).toHaveBeenCalledWith(
      '/pg/video/generations',
      {
        model: 'grok-imagine-video-1.5',
        group: 'default',
        prompt: 'A paper boat on a lake',
        duration: 5,
        seconds: '5',
        size: '1920x1080',
      },
      { skipErrorHandler: true }
    )
  })

  it('keeps a single reference as a reference, and omits stale fixed size and unsupported audio', async () => {
    const body = await buildVideoRequestBody({
      model: 'model',
      group: 'g',
      prompt: 'animate',
      capabilities: { ...adaptive, maxReferenceImages: 1 },
      settings: { ...DEFAULT_STUDIO_SETTINGS, videoSize: '1920x1080' },
      aspectRatio: 'adaptive',
      resolution: '720p',
      duration: 5,
      generateAudio: false,
      referenceImages: ['https://example.com/reference.png'],
    })
    expect(body).toEqual({
      model: 'model',
      group: 'g',
      prompt: 'animate',
      duration: 5,
      seconds: '5',
      metadata: { ratio: 'adaptive', resolution: '720p' },
      images: ['https://example.com/reference.png'],
    })
  })

  it.each([true, false])(
    'rejects an explicit audio choice %s after audio support disappears',
    async (generateAudio) => {
      vi.mocked(api.get).mockResolvedValue({
        data: { success: true, data: { text: adaptive } },
      })
      await expect(
        submitVideo({
          model: 'model',
          group: 'g',
          prompt: 'animate',
          settings: DEFAULT_STUDIO_SETTINGS,
          aspectRatio: 'adaptive',
          resolution: '720p',
          duration: 5,
          generateAudio,
        })
      ).rejects.toBeInstanceOf(Error)
      expect(api.post).not.toHaveBeenCalled()
    }
  )

  it('rejects an explicit audio choice when refreshed policy no longer supports it', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { text: adaptive } },
    })
    await expect(
      submitVideo({
        model: 'model',
        group: 'group-a',
        prompt: 'animate',
        settings: { ...DEFAULT_STUDIO_SETTINGS, videoSize: '1920x1080' },
        aspectRatio: 'adaptive',
        resolution: '720p',
        duration: 5,
        generateAudio: true,
      })
    ).rejects.toBeInstanceOf(Error)
    expect(api.get).toHaveBeenCalledWith('/api/playground/video-capabilities', {
      params: { group: 'group-a', model: 'model' },
    })
    expect(api.post).not.toHaveBeenCalled()
  })

  it('fails closed when the current mode disappeared before submission', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { text: adaptive } },
    })
    await expect(
      submitVideo({
        model: 'model',
        group: 'group-a',
        prompt: 'animate',
        settings: DEFAULT_STUDIO_SETTINGS,
        firstFrame: 'data:image/png;base64,YQ==',
      })
    ).rejects.toBeInstanceOf(Error)
    expect(api.post).not.toHaveBeenCalled()
  })

  it('blocks over-limit references without truncating or submitting', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { references: adaptive } },
    })
    await expect(
      submitVideo({
        model: 'model',
        group: 'group-a',
        prompt: 'animate',
        settings: DEFAULT_STUDIO_SETTINGS,
        referenceImages: ['a', 'b', 'c', 'd'],
      })
    ).rejects.toBeInstanceOf(Error)
    expect(api.post).not.toHaveBeenCalled()
  })
})
