import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { submitVideo } from './api'
import { DEFAULT_STUDIO_SETTINGS } from './lib/storage/store-migration'
import { getVideoReferenceLimit } from './lib/studio/model-modality'

vi.mock('@/lib/api', () => ({
  api: { post: vi.fn() },
  getCommonHeaders: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(api.post).mockReset()
  vi.mocked(api.post).mockResolvedValue({ data: { id: 'video-task' } })
})

const skipErrorHandler = { skipErrorHandler: true }

describe('video references', () => {
  it.each(['seedance-2-0', 'seedance-2-0-fast', 'doubao-seedance-2-0-260128'])(
    'sends all nine references in order without frame aliases for %s',
    async (model) => {
      const referenceImages = Array.from(
        { length: 9 },
        (_, i) => `data:image/png;base64,${i}`
      )
      const result = await submitVideo({
        model,
        group: 'default',
        prompt: 'animate',
        settings: DEFAULT_STUDIO_SETTINGS,
        referenceImages,
      })
      expect(result.taskId).toBe('video-task')
      expect(api.post).toHaveBeenCalledWith(
        '/pg/video/generations',
        {
          model,
          group: 'default',
          prompt: 'animate',
          duration: 5,
          seconds: '5',
          size: '1280x720',
          images: referenceImages,
        },
        skipErrorHandler
      )
    }
  )

  it('emits Volcengine metadata and a matching size for capability-driven seedance runs', async () => {
    await submitVideo({
      model: 'seedance-2-0',
      group: 'default',
      prompt: 'animate',
      settings: DEFAULT_STUDIO_SETTINGS,
      aspectRatio: '9:16',
      resolution: '1080p',
      duration: 8,
      generateAudio: false,
    })
    expect(api.post).toHaveBeenCalledWith(
      '/pg/video/generations',
      {
        model: 'seedance-2-0',
        group: 'default',
        prompt: 'animate',
        duration: 8,
        seconds: '8',
        size: '1080x1920',
        metadata: { resolution: '1080p', ratio: '9:16', generate_audio: false },
      },
      skipErrorHandler
    )
  })

  it('omits size for adaptive ratio and never sends metadata to non-Volcengine models', async () => {
    await submitVideo({
      model: 'seedance-2-0',
      group: 'default',
      prompt: 'animate',
      settings: DEFAULT_STUDIO_SETTINGS,
      aspectRatio: 'adaptive',
      resolution: '720p',
      duration: 5,
    })
    expect(api.post).toHaveBeenLastCalledWith(
      '/pg/video/generations',
      expect.not.objectContaining({ size: expect.anything() }),
      skipErrorHandler
    )

    vi.mocked(api.post).mockClear()
    await submitVideo({
      model: 'grok-imagine-video-1.5',
      group: 'default',
      prompt: 'animate',
      settings: DEFAULT_STUDIO_SETTINGS,
      aspectRatio: '16:9',
      resolution: '1080p',
      duration: 10,
      firstFrame: 'data:image/png;base64,YQ==',
    })
    expect(api.post).toHaveBeenLastCalledWith(
      '/pg/video/generations',
      {
        model: 'grok-imagine-video-1.5',
        group: 'default',
        prompt: 'animate',
        duration: 10,
        seconds: '10',
        size: '1920x1080',
        first_frame: 'data:image/png;base64,YQ==',
        input_reference: 'data:image/png;base64,YQ==',
        image: 'data:image/png;base64,YQ==',
        images: ['data:image/png;base64,YQ=='],
      },
      skipErrorHandler
    )
  })

  it('keeps first-frame semantics for other video models', async () => {
    await submitVideo({
      model: 'grok-imagine-video',
      group: 'default',
      prompt: 'animate',
      settings: DEFAULT_STUDIO_SETTINGS,
      referenceImages: ['data:image/png;base64,YQ=='],
    })
    expect(api.post).toHaveBeenCalledWith(
      '/pg/video/generations',
      expect.objectContaining({
        first_frame: 'data:image/png;base64,YQ==',
        input_reference: 'data:image/png;base64,YQ==',
        images: ['data:image/png;base64,YQ=='],
      }),
      skipErrorHandler
    )
    expect(getVideoReferenceLimit('doubao-seedance-1-5-pro')).toBe(1)
  })

  it.each([
    ['seedance-2-0', 10],
    ['grok-imagine-video', 2],
  ] as const)(
    'rejects excess references for %s instead of dropping images',
    async (model, count) => {
      await expect(
        submitVideo({
          model,
          group: 'default',
          prompt: 'animate',
          settings: DEFAULT_STUDIO_SETTINGS,
          referenceImages: Array(count).fill('data:image/png;base64,YQ=='),
        })
      ).rejects.toThrow()
      expect(api.post).not.toHaveBeenCalled()
    }
  )

  it('surfaces the task pre-consume message instead of Axios 403', async () => {
    vi.mocked(api.post).mockRejectedValueOnce({
      message: 'Request failed with status code 403',
      response: {
        data: {
          code: 'insufficient_user_quota',
          message: '预扣费失败：用户额度不足。需要 ₫15.51，剩余 ₫315,335.98',
        },
      },
    })
    await expect(
      submitVideo({
        model: 'dreamina-seedance-2-5',
        group: 'default',
        prompt: 'animate',
        settings: DEFAULT_STUDIO_SETTINGS,
      })
    ).rejects.toThrow('预扣费失败')
  })
})
