import { describe, expect, it } from 'vitest'

import { DEFAULT_STUDIO_SETTINGS } from '../storage/store-migration'
import {
  applyResolvedVideoSettings,
  assignVideoReferences,
  getVideoModelCapabilities,
  planVideoJobs,
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

describe('planVideoJobs', () => {
  it('repeats each line by count and caps the total at ten', () => {
    const plan = planVideoJobs({
      text: 'a\nb\nc\nd\ne\nf',
      batchMode: true,
      count: 2,
    })
    expect(plan.prompts).toHaveLength(10)
    expect(plan.truncated).toBe(2)
    expect(plan.prompts[0]).toBe('a')
    expect(plan.prompts[9]).toBe('e')
  })

  it('uses the trimmed single prompt when batch mode is off', () => {
    expect(
      planVideoJobs({ text: '  one  ', batchMode: false, count: 3 })
    ).toEqual({ prompts: ['one', 'one', 'one'], truncated: 0 })
  })
})

describe('assignVideoReferences', () => {
  it('sends first and last frame in frames mode, and only the first when the tail is disabled', () => {
    const images = ['data:a', 'data:b', 'data:c']
    expect(
      assignVideoReferences({
        model: 'seedance-2-0',
        references: images,
        referenceMode: 'frames',
      })
    ).toEqual({ firstFrame: 'data:a', lastFrame: 'data:b' })
    expect(
      assignVideoReferences({
        model: 'seedance-2-0',
        references: images,
        referenceMode: 'frames',
        disableLastFrame: true,
      })
    ).toEqual({ firstFrame: 'data:a', lastFrame: undefined })
  })

  it('caps reference-mode images and never uses last-frame on xAI', () => {
    const many = Array.from({ length: 12 }, (_, i) => `data:${i}`)
    expect(
      assignVideoReferences({
        model: 'seedance-2-0',
        references: many,
        referenceMode: 'references',
      }).referenceImages
    ).toEqual(many.slice(0, 9))
    expect(
      assignVideoReferences({
        model: 'grok-imagine-video-1.5',
        references: many,
        referenceMode: 'references',
      })
    ).toEqual({ firstFrame: 'data:0', lastFrame: undefined })
  })
})

describe('applyResolvedVideoSettings', () => {
  it('clamps stale 1080p onto the fast profile and writes the derived size', () => {
    const next = applyResolvedVideoSettings(
      {
        ...DEFAULT_STUDIO_SETTINGS,
        videoAspectRatio: '9:16',
        videoResolution: '1080p',
        videoDuration: 30,
      },
      getVideoModelCapabilities('seedance-2-0-fast'),
      {}
    )
    expect(next).toMatchObject({
      videoAspectRatio: '9:16',
      videoResolution: '720p',
      videoDuration: 15,
      videoSize: '720x1280',
    })
  })
})
