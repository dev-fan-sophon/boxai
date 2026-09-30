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
