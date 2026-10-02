import { bareModelId } from '@/features/playground/lib/studio/image-request-schema'
import type { StudioSettings } from '@/features/playground/types'

import type { CreateTool } from '../constants'
import type { GenerationDraft } from '../hooks/use-generation-draft'

/** The public API request equivalent to the run the panel would start. */
export function buildApiRequest(input: {
  modality: CreateTool
  model: string
  prompt: string
  settings: StudioSettings
  draft: Pick<GenerationDraft, 'videoOptions' | 'estimateParams'>
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
    const duration =
      input.draft.videoOptions?.duration ?? input.settings.videoDuration
    return {
      path: '/v1/video/generations',
      body: {
        model: input.model,
        prompt,
        duration,
        ...(input.draft.estimateParams.size
          ? { size: input.draft.estimateParams.size }
          : {}),
      },
    }
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
