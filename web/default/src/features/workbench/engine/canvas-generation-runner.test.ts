import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getVideoCapabilities, submitVideo } from '@/features/playground/api'
import { persistGeneratedMediaAsset } from '@/features/playground/lib/download-generated-media'
import type { VideoModelCapabilities } from '@/features/playground/lib/studio/video-capabilities'
import { getUserTaskLogs } from '@/features/usage-logs/api'

import {
  buildCanvasVideoSubmitInput,
  pollCanvasVideoTask,
  runCanvasVideoGeneration,
  resumeCanvasVideoGeneration,
} from './canvas-generation-runner'

vi.mock('@/features/playground/api', () => ({
  generateImages: vi.fn(),
  generateSpeech: vi.fn(),
  getVideoCapabilities: vi.fn(),
  submitVideo: vi.fn(),
  uploadPlaygroundAsset: vi.fn(),
}))
vi.mock('@/features/playground/lib/download-generated-media', () => ({
  persistGeneratedMediaAsset: vi.fn(),
}))
vi.mock('@/features/usage-logs/api', () => ({ getUserTaskLogs: vi.fn() }))

const images = ['data:a', 'data:b']
const capabilities: VideoModelCapabilities = {
  family: 'seedance-2',
  aspectRatios: ['16:9', '9:16'],
  resolutions: ['720p', '1080p'],
  imageOnlyResolutions: [],
  durations: [5, 8],
  durationRange: { min: 5, max: 8 },
  defaults: { aspectRatio: '16:9', resolution: '720p', duration: 5 },
  maxReferenceImages: 12,
  supportsLastFrame: true,
  requiresImage: false,
  supportsAudioToggle: true,
  usesVolcengineMetadata: true,
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getVideoCapabilities).mockResolvedValue({ text: capabilities })
})

describe('canvas video observation lifecycle', () => {
  it('reports an accepted task before respecting cancellation during submit', async () => {
    const controller = new AbortController()
    vi.mocked(submitVideo).mockImplementation(async () => {
      controller.abort()
      return { taskId: 'accepted', status: 'SUBMITTED' }
    })
    const onProgress = vi.fn()
    await expect(
      runCanvasVideoGeneration({
        prompt: 'p',
        referenceImages: [],
        settings: { model: 'seedance-2-0', group: '' },
        signal: controller.signal,
        onProgress,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(onProgress).toHaveBeenCalledWith({
      taskId: 'accepted',
      status: 'SUBMITTED',
      percent: null,
    })
    expect(getUserTaskLogs).not.toHaveBeenCalled()
  })

  it('drops a result when cancellation happens during persistence', async () => {
    const controller = new AbortController()
    vi.mocked(getUserTaskLogs).mockResolvedValue({
      data: { items: [{ task_id: 'task', status: 'SUCCESS' }] },
    } as Awaited<ReturnType<typeof getUserTaskLogs>>)
    vi.mocked(persistGeneratedMediaAsset).mockImplementation(async () => {
      controller.abort()
      throw new Error('storage unavailable')
    })
    await expect(
      resumeCanvasVideoGeneration({ taskId: 'task', signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reports terminal failure from upstream, but not from a transport rejection', async () => {
    const onProgress = vi.fn()
    vi.useFakeTimers()
    vi.mocked(getUserTaskLogs).mockRejectedValue(new Error('offline'))
    try {
      const rejection = expect(
        resumeCanvasVideoGeneration({ taskId: 'task', onProgress })
      ).rejects.toThrow('offline')
      await vi.runAllTimersAsync()
      await rejection
      expect(getUserTaskLogs).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
    expect(onProgress).not.toHaveBeenCalled()
    vi.mocked(getUserTaskLogs).mockResolvedValueOnce({
      data: {
        items: [
          { task_id: 'task', status: 'FAILURE', fail_reason: 'rejected' },
        ],
      },
    } as Awaited<ReturnType<typeof getUserTaskLogs>>)
    await expect(
      resumeCanvasVideoGeneration({ taskId: 'task', onProgress })
    ).rejects.toThrow('rejected')
    expect(onProgress).toHaveBeenCalledWith({
      taskId: 'task',
      status: 'FAILURE',
      percent: null,
    })
  })

  it('recovers from a transient polling failure without resubmitting the video', async () => {
    vi.useFakeTimers()
    const task = { task_id: 'accepted', status: 'SUCCESS', progress: '100%' }
    vi.mocked(getUserTaskLogs)
      .mockRejectedValueOnce(new Error('temporary 503'))
      .mockResolvedValueOnce({ data: { items: [task] } } as Awaited<
        ReturnType<typeof getUserTaskLogs>
      >)
    try {
      const result = pollCanvasVideoTask('accepted', {})
      await vi.runAllTimersAsync()
      expect(await result).toEqual(task)
      expect(getUserTaskLogs).toHaveBeenCalledTimes(2)
      expect(submitVideo).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('buildCanvasVideoSubmitInput', () => {
  it('sends first and last frame in frames mode, and only the first when the tail is disabled', () => {
    const settings = { model: 'seedance-2-0', group: 'g', seconds: '8' }
    const withTail = buildCanvasVideoSubmitInput({
      prompt: 'p',
      referenceImages: images,
      settings,
      capabilities,
    })
    expect(withTail).toMatchObject({
      firstFrame: 'data:a',
      lastFrame: 'data:b',
      duration: 8,
      aspectRatio: '16:9',
      resolution: '720p',
      generateAudio: true,
    })
    expect(withTail.referenceImages).toBeUndefined()

    const noTail = buildCanvasVideoSubmitInput({
      prompt: 'p',
      referenceImages: images.slice(0, 1),
      disableLastFrame: true,
      settings,
      capabilities,
    })
    expect(noTail.firstFrame).toBe('data:a')
    expect(noTail.lastFrame).toBeUndefined()
  })

  it('sends every connected image as a reference in references mode', () => {
    const many = Array.from({ length: 12 }, (_, i) => `data:${i}`)
    const input = buildCanvasVideoSubmitInput({
      prompt: 'p',
      referenceImages: many,
      settings: {
        model: 'seedance-2-0',
        group: 'g',
        videoReferenceMode: 'references',
        generateAudio: false,
      },
      capabilities,
    })
    expect(input.referenceImages).toEqual(many)
    expect(input.firstFrame).toBeUndefined()
    expect(input.generateAudio).toBe(false)
  })

  it('never uses a last frame or audio flag on models without support', () => {
    const input = buildCanvasVideoSubmitInput({
      prompt: 'p',
      referenceImages: images.slice(0, 1),
      settings: {
        model: 'grok-imagine-video-1.5',
        group: 'g',
        resolution: '1080p',
        videoReferenceMode: 'references',
        generateAudio: true,
      },
      capabilities: {
        ...capabilities,
        family: 'xai',
        maxReferenceImages: 1,
        supportsLastFrame: false,
        supportsAudioToggle: false,
      },
    })
    expect(input).toMatchObject({
      referenceImages: ['data:a'],
      resolution: '1080p',
    })
    expect(input.firstFrame).toBeUndefined()
    expect(input.lastFrame).toBeUndefined()
    expect(input.generateAudio).toBeUndefined()
  })
})
