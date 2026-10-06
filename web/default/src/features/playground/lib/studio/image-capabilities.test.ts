import { describe, expect, it } from 'vitest'

import {
  imageMimeFromBase64,
  parseImageCapabilities,
  resolveImageOptions,
  type ImageModelCapabilities,
} from './image-capabilities'
import { buildImageGenerationRequestBody } from './image-request-schema'

const gpt: ImageModelCapabilities = {
  family: 'gpt-image',
  modes: ['generate', 'edit'],
  maxReferenceImages: 16,
  sizeMode: 'pixels',
  sizes: ['auto', '1024x1024', '3840x2160'],
  aspectRatios: [],
  resolutions: [],
  qualities: ['auto', 'low', 'medium', 'high'],
  maxN: 1,
  supportsMask: true,
  backgrounds: ['auto', 'opaque', 'transparent'],
  outputFormats: ['png', 'jpeg', 'webp'],
  moderation: ['auto', 'low'],
  defaults: {
    size: '1024x1024',
    quality: 'auto',
    background: 'auto',
    outputFormat: 'png',
  },
}

const xai: ImageModelCapabilities = {
  ...gpt,
  family: 'xai',
  maxReferenceImages: 5,
  sizeMode: 'aspect',
  sizes: [],
  aspectRatios: ['auto', '1:1', '16:9', '19.5:9'],
  resolutions: ['1k', '2k'],
  qualities: ['auto', 'low', 'medium'],
  maxN: 10,
  supportsMask: false,
  backgrounds: [],
  outputFormats: [],
  moderation: [],
  defaults: { aspectRatio: 'auto', resolution: '1k', quality: 'auto' },
}

const gemini: ImageModelCapabilities = {
  ...xai,
  family: 'gemini',
  maxReferenceImages: 14,
  aspectRatios: ['1:1', '16:9', '21:9'],
  resolutions: ['1K'],
  qualities: [],
  maxN: 1,
  defaults: { aspectRatio: '1:1', resolution: '1K' },
}

const settings = {
  imageCount: 1,
  imageSize: '3840x2160',
  imageQuality: 'high',
  imageAspectRatio: '16:9',
  imageResolution: '2K',
  imageBackground: 'transparent',
  imageOutputFormat: 'jpeg',
}

describe('parseImageCapabilities', () => {
  it('accepts the endpoint payload and rejects malformed data', () => {
    expect(parseImageCapabilities(gpt)?.family).toBe('gpt-image')
    expect(parseImageCapabilities(null)).toBeNull()
    expect(parseImageCapabilities({ ...gpt, family: 'flux' })).toBeNull()
    expect(parseImageCapabilities({ ...gpt, sizeMode: 'other' })).toBeNull()
  })
})

describe('resolveImageOptions', () => {
  it('forces png when a transparent background was paired with jpeg', () => {
    expect(resolveImageOptions(gpt, settings)).toEqual({
      size: '3840x2160',
      quality: 'high',
      background: 'transparent',
      outputFormat: 'png',
    })
  })

  it('canonicalizes resolution spelling and falls back to model defaults', () => {
    expect(resolveImageOptions(xai, settings)).toEqual({
      aspectRatio: '16:9',
      resolution: '2k',
      quality: 'auto',
    })
    expect(resolveImageOptions(gemini, settings)).toEqual({
      aspectRatio: '16:9',
      resolution: '1K',
      quality: undefined,
    })
  })
})

describe('buildImageGenerationRequestBody with capabilities', () => {
  const references = {
    referenceImage: 'data:image/png;base64,a',
    referenceImages: ['data:image/png;base64,b'],
  }

  it('sends only GPT Image fields and the mask for gpt-image-2', () => {
    expect(
      buildImageGenerationRequestBody({
        model: 'gpt-image-2',
        group: 'default',
        prompt: 'p',
        settings,
        capabilities: gpt,
        mask: 'data:image/png;base64,m',
        ...references,
      })
    ).toEqual({
      model: 'gpt-image-2',
      group: 'default',
      prompt: 'p',
      n: 1,
      size: '3840x2160',
      quality: 'high',
      background: 'transparent',
      output_format: 'png',
      image: 'data:image/png;base64,a',
      images: ['data:image/png;base64,a', 'data:image/png;base64,b'],
      mask: 'data:image/png;base64,m',
    })
  })

  it('sends GPT Image 2.5 xhigh/max qualities, one image per call and the mask', () => {
    // Server-reported contract; sizes come from the capability endpoint.
    const gpt25: ImageModelCapabilities = {
      ...gpt,
      sizes: ['auto', '1024x1024', '2048x1152'],
      qualities: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
      maxN: 1,
    }
    for (const quality of ['xhigh', 'max']) {
      expect(
        buildImageGenerationRequestBody({
          model: 'gpt-image-2.5-sunburst',
          group: 'default',
          prompt: 'p',
          settings: {
            ...settings,
            imageCount: 4,
            imageSize: '2048x1152',
            imageQuality: quality,
            imageBackground: 'opaque',
            imageOutputFormat: 'webp',
          },
          capabilities: gpt25,
          mask: 'data:image/png;base64,m',
          ...references,
        })
      ).toEqual({
        model: 'gpt-image-2.5-sunburst',
        group: 'default',
        prompt: 'p',
        n: 1,
        size: '2048x1152',
        quality,
        background: 'opaque',
        output_format: 'webp',
        image: 'data:image/png;base64,a',
        images: ['data:image/png;base64,a', 'data:image/png;base64,b'],
        mask: 'data:image/png;base64,m',
      })
    }
  })

  it('clamps xhigh to the model default when the contract lacks it', () => {
    const body = buildImageGenerationRequestBody({
      model: 'gpt-image-2',
      group: 'default',
      prompt: 'p',
      settings: { ...settings, imageQuality: 'xhigh' },
      capabilities: gpt,
    })
    expect(body.quality).toBeUndefined()
  })

  it('sends aspect ratio and resolution for Grok and never a mask', () => {
    expect(
      buildImageGenerationRequestBody({
        model: 'grok-imagine-image-2.0',
        group: 'default',
        prompt: 'p',
        settings,
        capabilities: xai,
        mask: 'data:image/png;base64,m',
        ...references,
      })
    ).toEqual({
      model: 'grok-imagine-image-2.0',
      group: 'default',
      prompt: 'p',
      n: 1,
      aspect_ratio: '16:9',
      resolution: '2k',
      image: 'data:image/png;base64,a',
      images: ['data:image/png;base64,a', 'data:image/png;base64,b'],
    })
  })

  it('sends Gemini options without GPT size or quality', () => {
    const body = buildImageGenerationRequestBody({
      model: 'gemini-3.1-flash-lite-image',
      group: 'default',
      prompt: 'p',
      settings,
      capabilities: gemini,
    })
    expect(body).toEqual({
      model: 'gemini-3.1-flash-lite-image',
      group: 'default',
      prompt: 'p',
      n: 1,
      aspect_ratio: '16:9',
      resolution: '1K',
    })
  })
})

describe('imageMimeFromBase64', () => {
  it('detects the real image type from magic bytes', () => {
    expect(imageMimeFromBase64('iVBORw0KGgo')).toBe('image/png')
    expect(imageMimeFromBase64('/9j/4AAQ')).toBe('image/jpeg')
    expect(imageMimeFromBase64('UklGRiQ')).toBe('image/webp')
    expect(imageMimeFromBase64('????', 'webp')).toBe('image/webp')
  })
})
