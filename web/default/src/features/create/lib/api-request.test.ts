import { describe, expect, it } from 'vitest'

import { DEFAULT_STUDIO_SETTINGS } from '@/features/playground/lib/storage/store-migration'
import type { VideoModelCapabilities } from '@/features/playground/lib/studio/video-capabilities'

import { buildApiRequest } from './api-request'

const seedance: VideoModelCapabilities = {
  family: 'seedance-2',
  aspectRatios: ['16:9'],
  resolutions: ['720p'],
  imageOnlyResolutions: [],
  durations: [5],
  durationRange: { min: 4, max: 15 },
  defaults: { aspectRatio: '16:9', resolution: '720p', duration: 5 },
  maxReferenceImages: 9,
  maxReferenceVideos: 3,
  maxReferenceAudios: 3,
  supportsLastFrame: false,
  requiresImage: false,
  supportsAudioToggle: true,
  usesVolcengineMetadata: true,
  supportsSeed: true,
  supportsWatermark: true,
  returnsLastFrame: true,
}

const videoOptions = {
  aspectRatio: '16:9' as const,
  resolution: '720p' as const,
  duration: 9,
  generateAudio: false,
  referenceMode: 'references' as const,
  count: 1,
}

describe('video API snippet', () => {
  it('mirrors typed references and metadata options with placeholder media', () => {
    const request = buildApiRequest({
      modality: 'video',
      model: 'seedance-2-0',
      prompt: 'dance',
      settings: { ...DEFAULT_STUDIO_SETTINGS, videoSeed: 7 },
      draft: {
        videoOptions,
        videoCapabilities: seedance,
        capabilityMode: 'references',
        estimateParams: {
          modality: 'video',
          n: 1,
          size: '1280x720',
          duration: 9,
          has_reference: true,
        },
        referenceCounts: { images: 1, videos: 2, audios: 1 },
      },
    })
    expect(request).toEqual({
      path: '/v1/video/generations',
      body: {
        model: 'seedance-2-0',
        prompt: 'dance',
        duration: 9,
        size: '1280x720',
        metadata: {
          generate_audio: false,
          resolution: '720p',
          ratio: '16:9',
          seed: 7,
          return_last_frame: true,
        },
        reference_images: ['https://example.com/reference-1.png'],
        reference_videos: [
          'https://example.com/clip-1.mp4',
          'https://example.com/clip-2.mp4',
        ],
        reference_audios: ['https://example.com/audio-1.mp3'],
      },
    })
  })
})
