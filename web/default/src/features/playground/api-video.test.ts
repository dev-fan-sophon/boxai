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

  it('sends typed Seedance references with seed, watermark and last-frame output', async () => {
    const seedance: VideoModelCapabilities = {
      ...adaptive,
      family: 'seedance-2',
      aspectRatios: ['16:9'],
      defaults: { aspectRatio: '16:9', resolution: '720p', duration: 5 },
      maxReferenceImages: 9,
      maxReferenceVideos: 3,
      maxReferenceAudios: 3,
      audioReferenceRequiresVisual: true,
      supportsLastFrame: false,
      supportsAudioToggle: true,
      supportsSeed: true,
      supportsWatermark: true,
      returnsLastFrame: true,
    }
    const body = await buildVideoRequestBody({
      model: 'seedance-2-0',
      group: 'default',
      prompt: 'dance',
      settings: DEFAULT_STUDIO_SETTINGS,
      capabilities: seedance,
      aspectRatio: '16:9',
      resolution: '720p',
      duration: 7,
      generateAudio: false,
      seed: 42,
      watermark: false,
      referenceImages: ['https://m/i.png'],
      referenceVideos: ['https://m/v.mp4'],
      referenceAudios: ['https://m/a.mp3'],
    })
    expect(body).toEqual({
      model: 'seedance-2-0',
      group: 'default',
      prompt: 'dance',
      duration: 7,
      seconds: '7',
      size: '1280x720',
      images: ['https://m/i.png'],
      reference_videos: ['https://m/v.mp4'],
      reference_audios: ['https://m/a.mp3'],
      metadata: {
        generate_audio: false,
        resolution: '720p',
        ratio: '16:9',
        seed: 42,
        watermark: false,
        return_last_frame: true,
      },
    })
    await expect(
      buildVideoRequestBody({
        model: 'seedance-2-0',
        group: 'default',
        prompt: 'dance',
        settings: DEFAULT_STUDIO_SETTINGS,
        capabilities: seedance,
        referenceAudios: ['https://m/a.mp3'],
      })
    ).rejects.toThrow()
    await expect(
      buildVideoRequestBody({
        model: 'seedance-2-0',
        group: 'default',
        prompt: 'dance',
        settings: DEFAULT_STUDIO_SETTINGS,
        capabilities: seedance,
        referenceVideos: ['1', '2', '3', '4'],
      })
    ).rejects.toThrow()
  })

  it('sends xAI references as reference_images and audio as metadata only', async () => {
    const xai: VideoModelCapabilities = {
      ...adaptive,
      family: 'xai',
      aspectRatios: ['3:2'],
      resolutions: ['480p', '720p'],
      defaults: { aspectRatio: '3:2', resolution: '720p', duration: 5 },
      maxReferenceImages: 7,
      supportsLastFrame: false,
      supportsAudioToggle: true,
      usesVolcengineMetadata: false,
    }
    const body = await buildVideoRequestBody({
      model: 'grok-imagine-video-1.5',
      group: 'default',
      prompt: 'a product spin',
      settings: DEFAULT_STUDIO_SETTINGS,
      capabilities: xai,
      aspectRatio: '3:2',
      resolution: '480p',
      duration: 6,
      generateAudio: true,
      seed: 9,
      referenceImages: ['https://m/a.png', 'https://m/b.png'],
    })
    expect(body).toEqual({
      model: 'grok-imagine-video-1.5',
      group: 'default',
      prompt: 'a product spin',
      duration: 6,
      seconds: '6',
      size: '720x480',
      reference_images: ['https://m/a.png', 'https://m/b.png'],
      metadata: { generate_audio: true },
    })
  })
})
