import { bareModelId } from '@/features/playground/lib/studio/image-request-schema'
import type { StudioSettings } from '@/features/playground/types'

import type { CreateTool } from '../constants'
import type { GenerationDraft } from '../hooks/use-generation-draft'

/** The parts of the generation draft the API snippet mirrors. */
export type ApiRequestDraft = Pick<
  GenerationDraft,
  'videoOptions' | 'estimateParams' | 'videoCapabilities' | 'capabilityMode'
> &
  Partial<Pick<GenerationDraft, 'referenceCounts' | 'usesLastFrame'>>

/** The public API request equivalent to the run the panel would start. */
export function buildApiRequest(input: {
  modality: CreateTool
  model: string
  prompt: string
  settings: StudioSettings
  draft: ApiRequestDraft
}): { path: string; body: Record<string, unknown> } {
  const prompt = input.prompt.trim() || 'A lighthouse on a cliff at sunrise'
  if (input.modality === 'image') {
    return {
      path: '/v1/images/generations',
      body: {
        model: bareModelId(input.model) || input.model,
        prompt,
        n: input.settings.imageCount,
        size: input.settings.imageSize,
        quality: input.settings.imageQuality,
      },
    }
  }
  if (input.modality === 'video') {
    return { path: '/v1/video/generations', body: buildVideoApiBody(input) }
  }
  return {
    path: '/v1/audio/speech',
    body: {
      model: input.model,
      input: prompt,
      voice: input.settings.voice,
      speed: input.settings.speed,
      response_format: input.settings.audioFormat,
    },
  }
}

/** Placeholder media: the snippet never leaks private studio asset links. */
function exampleUrls(kind: string, count: number, extension: string) {
  return Array.from(
    { length: count },
    (_, index) => `https://example.com/${kind}-${index + 1}.${extension}`
  )
}

/**
 * Video body mirroring the studio request: duration and size, the options
 * the selected model reads from metadata, and frames or typed references.
 */
function buildVideoApiBody(input: {
  model: string
  prompt: string
  settings: StudioSettings
  draft: ApiRequestDraft
}): Record<string, unknown> {
  const prompt = input.prompt.trim() || 'A lighthouse on a cliff at sunrise'
  const options = input.draft.videoOptions
  const capabilities = input.draft.videoCapabilities
  const duration = options?.duration ?? input.settings.videoDuration
  const body: Record<string, unknown> = {
    model: input.model,
    prompt,
    duration,
  }
  if (input.draft.estimateParams.size) {
    body.size = input.draft.estimateParams.size
  }
  const metadata: Record<string, unknown> = {}
  if (capabilities?.supportsAudioToggle && options) {
    metadata.generate_audio = options.generateAudio
  }
  if (capabilities?.usesVolcengineMetadata && options) {
    metadata.resolution = options.resolution
    metadata.ratio = options.aspectRatio
    if (
      capabilities.supportsSeed &&
      typeof input.settings.videoSeed === 'number'
    ) {
      metadata.seed = input.settings.videoSeed
    }
    if (capabilities.supportsWatermark && input.settings.videoWatermark) {
      metadata.watermark = true
    }
    if (capabilities.returnsLastFrame) metadata.return_last_frame = true
  }
  if (Object.keys(metadata).length) body.metadata = metadata

  const counts = input.draft.referenceCounts
  if (input.draft.capabilityMode === 'frames') {
    body.first_frame = 'https://example.com/first-frame.png'
    if (input.draft.usesLastFrame && (counts?.images ?? 0) > 1) {
      body.last_frame = 'https://example.com/last-frame.png'
    }
  } else if (input.draft.capabilityMode === 'references' && counts) {
    if (counts.images > 0) {
      body.reference_images = exampleUrls('reference', counts.images, 'png')
    }
    if (counts.videos > 0) {
      body.reference_videos = exampleUrls('clip', counts.videos, 'mp4')
    }
    if (counts.audios > 0) {
      body.reference_audios = exampleUrls('audio', counts.audios, 'mp3')
    }
  }
  return body
}
