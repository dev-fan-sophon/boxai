import { describe, expect, it } from 'vitest'

import { DEFAULT_STUDIO_SETTINGS } from '../storage/store-migration'
import { buildPlaygroundVideoSubmitInput } from './video-submit'

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
      references: ['data:a', 'data:b', 'data:c'],
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
    })
    expect(input).toMatchObject({
      firstFrame: 'data:a',
      resolution: '1080p',
    })
    expect(input.generateAudio).toBeUndefined()
    expect(input.referenceImages).toBeUndefined()
  })
})
