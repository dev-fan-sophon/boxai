import { describe, expect, it } from 'vitest'

import {
  getVideoModelCapabilities,
  resolveVideoOptions,
  splitBatchPrompts,
  videoOptionsFromSize,
  videoSizeForOptions,
} from './video-capabilities'

describe('getVideoModelCapabilities', () => {
  it.each([
    ['seedance-2-0', 'seedance-2', 9, 15],
    ['doubao-seedance-2-0-fast-260128', 'seedance-2-fast', 9, 15],
    ['dreamina-seedance-2-5', 'seedance-2.5', 30, 30],
    ['grok-imagine-video-1.5', 'xai', 1, 15],
    ['kling-v2', 'generic', 1, 60],
  ] as const)(
    'maps %s to the %s profile',
    (model, family, maxReferenceImages, maxDuration) => {
      const capabilities = getVideoModelCapabilities(model)
      expect(capabilities.family).toBe(family)
      expect(capabilities.maxReferenceImages).toBe(maxReferenceImages)
      expect(capabilities.durationRange.max).toBe(maxDuration)
    }
  )

  it('keeps 1080p off the fast tier and marks xAI 1080p as image-only', () => {
    expect(getVideoModelCapabilities('seedance-2-0-fast').resolutions).toEqual([
      '480p',
      '720p',
    ])
    expect(
      getVideoModelCapabilities('grok-imagine-video-1.5').imageOnlyResolutions
    ).toEqual(['1080p'])
  })
})

describe('resolveVideoOptions', () => {
  it('falls back to defaults when stale metadata is unsupported by the new model', () => {
    const fast = getVideoModelCapabilities('seedance-2-0-fast')
    expect(
      resolveVideoOptions(fast, {
        aspectRatio: '21:9',
        resolution: '1080p',
        seconds: '30',
      })
    ).toMatchObject({ aspectRatio: '21:9', resolution: '720p', duration: 15 })
  })

  it('downgrades image-only resolutions when no image is connected', () => {
    const xai = getVideoModelCapabilities('grok-imagine-video-1.5')
    expect(
      resolveVideoOptions(xai, { resolution: '1080p' }, { hasImage: false })
        .resolution
    ).toBe('720p')
    expect(
      resolveVideoOptions(xai, { resolution: '1080p' }, { hasImage: true })
        .resolution
    ).toBe('1080p')
  })

  it('recovers ratio and resolution from legacy size metadata', () => {
    const seedance = getVideoModelCapabilities('seedance-2-0')
    expect(
      resolveVideoOptions(seedance, { size: '720x1280', seconds: '8' })
    ).toMatchObject({ aspectRatio: '9:16', resolution: '720p', duration: 8 })
  })

  it('only enables references mode and audio on models that support them', () => {
    const seedance = getVideoModelCapabilities('seedance-2-0')
    const xai = getVideoModelCapabilities('grok-imagine-video-1.5')
    expect(
      resolveVideoOptions(seedance, { referenceMode: 'references' })
        .referenceMode
    ).toBe('references')
    expect(
      resolveVideoOptions(xai, { referenceMode: 'references' }).referenceMode
    ).toBe('frames')
    expect(resolveVideoOptions(seedance, {}).generateAudio).toBe(true)
    expect(
      resolveVideoOptions(seedance, { generateAudio: false }).generateAudio
    ).toBe(false)
    expect(
      resolveVideoOptions(xai, { generateAudio: true }).generateAudio
    ).toBe(false)
  })

  it('clamps count to the supported range', () => {
    const seedance = getVideoModelCapabilities('seedance-2-0')
    expect(resolveVideoOptions(seedance, { count: 0 }).count).toBe(1)
    expect(resolveVideoOptions(seedance, { count: 9 }).count).toBe(4)
  })
})

describe('size mapping', () => {
  it('round-trips every ratio/resolution pair except adaptive', () => {
    expect(videoSizeForOptions('16:9', '1080p')).toBe('1920x1080')
    expect(videoOptionsFromSize('1920x1080')).toEqual({
      aspectRatio: '16:9',
      resolution: '1080p',
    })
    expect(videoSizeForOptions('adaptive', '720p')).toBeUndefined()
    expect(videoOptionsFromSize('123x456')).toBeUndefined()
  })
})

describe('splitBatchPrompts', () => {
  it('ignores blank and whitespace-only lines and trims the rest', () => {
    expect(splitBatchPrompts('  a sunrise \n\n   \r\nb\tsunset\n')).toEqual([
      'a sunrise',
      'b\tsunset',
    ])
  })
})
