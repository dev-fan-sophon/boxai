import { describe, expect, it } from 'vitest'

import { DEFAULT_STUDIO_SETTINGS } from '../storage/store-migration'
import type { VideoModelCapabilities } from './video-capabilities'
import { buildPlaygroundVideoSubmitInput } from './video-submit'

const capabilities: VideoModelCapabilities = {
  family: 'seedance-2',
  aspectRatios: ['16:9', '9:16'],
  resolutions: ['720p', '1080p'],
  imageOnlyResolutions: [],
  durations: [5, 8],
  durationRange: { min: 5, max: 8 },
  defaults: { aspectRatio: '16:9', resolution: '720p', duration: 5 },
  maxReferenceImages: 3,
  supportsLastFrame: true,
  requiresImage: false,
  supportsAudioToggle: true,
  usesVolcengineMetadata: true,
}

describe('buildPlaygroundVideoSubmitInput', () => {
  it('sends capability-driven options and first/last frames from playground settings', () => {
    const input = buildPlaygroundVideoSubmitInput({
      model: 'seedance-2-0',
      group: 'default',
      prompt: 'animate',
      settings: {
        ...DEFAULT_STUDIO_SETTINGS,
        videoAspectRatio: '9:16',
        videoResolution: '1080p',
        videoDuration: 8,
        videoGenerateAudio: false,
        videoReferenceMode: 'frames',
      },
      references: ['data:a', 'data:b'],
      capabilities,
    })
    expect(input).toMatchObject({
      aspectRatio: '9:16',
      resolution: '1080p',
      duration: 8,
      generateAudio: false,
      firstFrame: 'data:a',
      lastFrame: 'data:b',
    })
    expect(input.referenceImages).toBeUndefined()
  })

  it('omits the audio flag on models that do not support it', () => {
    const input = buildPlaygroundVideoSubmitInput({
      model: 'grok-imagine-video-1.5',
      group: 'default',
      prompt: 'animate',
      settings: {
        ...DEFAULT_STUDIO_SETTINGS,
        videoGenerateAudio: true,
        videoReferenceMode: 'references',
        videoResolution: '1080p',
      },
      references: ['data:a'],
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
    expect(input.generateAudio).toBeUndefined()
  })
})

describe('buildPlaygroundVideoSubmitInput reference mode', () => {
  it('seeds a chained scene as a first frame while the draft is in references mode', () => {
    const input = buildPlaygroundVideoSubmitInput({
      model: 'dreamina-seedance-2-5',
      group: 'default',
      prompt: 'next scene',
      settings: {
        ...DEFAULT_STUDIO_SETTINGS,
        videoReferenceMode: 'references',
      },
      referenceMode: 'frames',
      references: ['data:last-frame'],
      capabilities: {
        ...capabilities,
        family: 'seedance-2.5',
        aspectRatios: ['16:9', 'adaptive'],
        maxReferenceImages: 30,
        maxReferenceVideos: 10,
      },
    })
    expect(input.firstFrame).toBe('data:last-frame')
    expect(input.lastFrame).toBeUndefined()
    expect(input.referenceImages).toBeUndefined()
    expect(input.settings.videoReferenceMode).toBe('frames')
  })

  it('pins Seedance 2.5 to the reference video ratio', () => {
    const input = buildPlaygroundVideoSubmitInput({
      model: 'dreamina-seedance-2-5',
      group: 'default',
      prompt: 'keep the motion',
      settings: {
        ...DEFAULT_STUDIO_SETTINGS,
        videoAspectRatio: '16:9',
        videoReferenceMode: 'references',
      },
      references: [],
      referenceVideos: ['https://media.test/clip.mp4'],
      capabilities: {
        ...capabilities,
        family: 'seedance-2.5',
        aspectRatios: ['16:9', 'adaptive'],
        maxReferenceImages: 30,
        maxReferenceVideos: 10,
      },
    })
    expect(input.aspectRatio).toBe('adaptive')
    expect(input.referenceVideos).toEqual(['https://media.test/clip.mp4'])
  })
})
