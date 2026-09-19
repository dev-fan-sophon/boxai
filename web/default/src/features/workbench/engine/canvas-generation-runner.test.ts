import { describe, expect, it, vi } from 'vitest'

import { buildCanvasVideoSubmitInput } from './canvas-generation-runner'

vi.mock('@/features/playground/api', () => ({
  generateImages: vi.fn(),
  generateSpeech: vi.fn(),
  submitVideo: vi.fn(),
  uploadPlaygroundAsset: vi.fn(),
}))
vi.mock('@/features/playground/lib/download-generated-media', () => ({
  persistGeneratedMediaAsset: vi.fn(),
}))
vi.mock('@/features/usage-logs/api', () => ({ getUserTaskLogs: vi.fn() }))

const images = ['data:a', 'data:b', 'data:c']

describe('buildCanvasVideoSubmitInput', () => {
  it('sends first and last frame in frames mode, and only the first when the tail is disabled', () => {
    const settings = { model: 'seedance-2-0', group: 'g', seconds: '8' }
    const withTail = buildCanvasVideoSubmitInput({
      prompt: 'p',
      referenceImages: images,
      settings,
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
      referenceImages: images,
      disableLastFrame: true,
      settings,
    })
    expect(noTail.firstFrame).toBe('data:a')
    expect(noTail.lastFrame).toBeUndefined()
  })

  it('sends every connected image as a reference in references mode, capped by the model', () => {
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
    })
    expect(input.referenceImages).toEqual(many.slice(0, 9))
    expect(input.firstFrame).toBeUndefined()
    expect(input.generateAudio).toBe(false)
  })

  it('never uses a last frame or audio flag on models without support', () => {
    const input = buildCanvasVideoSubmitInput({
      prompt: 'p',
      referenceImages: images,
      settings: {
        model: 'grok-imagine-video-1.5',
        group: 'g',
        resolution: '1080p',
        videoReferenceMode: 'references',
        generateAudio: true,
      },
    })
    expect(input).toMatchObject({ firstFrame: 'data:a', resolution: '1080p' })
    expect(input.referenceImages).toBeUndefined()
    expect(input.lastFrame).toBeUndefined()
    expect(input.generateAudio).toBeUndefined()
  })
})
