import { describe, expect, it } from 'vitest'

import { DEFAULT_STUDIO_SETTINGS } from '../storage/store-migration'
import {
  applyResolvedVideoSettings,
  assignVideoReferences,
  resolveVideoOptions,
  videoResolutionsForRatio,
  videoDurationOptions,
  videoOptionsFromSize,
  videoSizeForOptions,
  type VideoModelCapabilities,
} from './video-capabilities'

const capabilities: VideoModelCapabilities = {
  family: 'seedance-2.5',
  aspectRatios: ['adaptive'],
  resolutions: ['720p'],
  imageOnlyResolutions: [],
  durations: [5, 10],
  durationRange: { min: 5, max: 10 },
  defaults: { aspectRatio: 'adaptive', resolution: '720p', duration: 5 },
  maxReferenceImages: 3,
  supportsLastFrame: true,
  requiresImage: false,
  supportsAudioToggle: true,
  usesVolcengineMetadata: true,
}

describe('server video capability resolution', () => {
  it('clamps restored settings and does not restore a fixed size for adaptive', () => {
    const options = resolveVideoOptions(capabilities, {
      aspectRatio: '16:9',
      resolution: '1080p',
      seconds: 30,
      size: '1920x1080',
    })
    expect(options).toMatchObject({
      aspectRatio: 'adaptive',
      resolution: '720p',
      duration: 10,
    })
    expect(
      applyResolvedVideoSettings(
        { ...DEFAULT_STUDIO_SETTINGS, videoSize: '1920x1080' },
        capabilities,
        {}
      ).videoSize
    ).toBe('')
  })

  it('rejects over-limit references instead of silently truncating them', () => {
    const references = ['a', 'b', 'c', 'd']
    expect(() =>
      assignVideoReferences({
        capabilities,
        references,
        referenceMode: 'references',
      })
    ).toThrow()
  })

  it('retains 1080p for landscape but excludes it for portrait when the adapter restricts the pair', () => {
    const profile: VideoModelCapabilities = {
      ...capabilities,
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p'],
      resolutionAspectRatios: { '1080p': ['16:9'] },
      defaults: { aspectRatio: '16:9', resolution: '720p', duration: 5 },
    }
    expect(videoResolutionsForRatio(profile, '16:9')).toEqual(['720p', '1080p'])
    expect(videoResolutionsForRatio(profile, '9:16')).toEqual(['720p'])
    expect(
      resolveVideoOptions(profile, { aspectRatio: '9:16', resolution: '1080p' })
        .resolution
    ).toBe('720p')
  })

  it('maps fixed sizes but emits no fixed size for adaptive', () => {
    expect(videoSizeForOptions('adaptive', '720p')).toBeUndefined()
    expect(videoOptionsFromSize('1920x1080')).toEqual({
      aspectRatio: '16:9',
      resolution: '1080p',
    })
  })

  it('offers every whole second of a short range and presets for a wide one', () => {
    expect(
      videoDurationOptions({
        ...capabilities,
        durations: [4, 5, 8],
        durationRange: { min: 4, max: 15 },
      })
    ).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(
      videoDurationOptions({
        ...capabilities,
        durations: [5, 60],
        durationRange: { min: 1, max: 120 },
      })
    ).toEqual([5, 60])
  })

  it('round-trips the xAI 3:2 and 2:3 sizes at every resolution', () => {
    for (const resolution of ['480p', '720p', '1080p'] as const) {
      for (const aspectRatio of ['3:2', '2:3'] as const) {
        const size = videoSizeForOptions(aspectRatio, resolution)
        expect(size).toBeDefined()
        expect(videoOptionsFromSize(size)).toEqual({ aspectRatio, resolution })
      }
    }
    expect(videoSizeForOptions('3:2', '480p')).toBe('720x480')
  })
})
