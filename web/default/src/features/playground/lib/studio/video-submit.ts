import type { VideoSubmitInput } from '../../api'
import type { StudioSettings } from '../../types'
import { DEFAULT_STUDIO_SETTINGS } from '../storage/store-migration'
import {
  assignVideoReferences,
  getVideoModelCapabilities,
  resolveVideoOptions,
} from './video-capabilities'

/**
 * Resolves playground studio settings into the same video request the canvas
 * sends: capability-clamped size/duration/audio plus first/last frames or
 * reference images.
 */
export function buildPlaygroundVideoSubmitInput(input: {
  model: string
  group: string
  prompt: string
  settings: StudioSettings
  references: string[]
}): VideoSubmitInput {
  const capabilities = getVideoModelCapabilities(input.model)
  const options = resolveVideoOptions(
    capabilities,
    {
      aspectRatio: input.settings.videoAspectRatio,
      resolution: input.settings.videoResolution,
      seconds: input.settings.videoDuration,
      size: input.settings.videoSize,
      generateAudio: input.settings.videoGenerateAudio,
      referenceMode: input.settings.videoReferenceMode,
      count: input.settings.videoCount,
    },
    { hasImage: input.references.length > 0 }
  )
  const assigned = assignVideoReferences({
    model: input.model,
    references: input.references,
    referenceMode: options.referenceMode,
    disableLastFrame: input.settings.videoDisableLastFrame,
  })
  return {
    model: input.model,
    group: input.group,
    prompt: input.prompt,
    settings: input.settings ?? DEFAULT_STUDIO_SETTINGS,
    aspectRatio: options.aspectRatio,
    resolution: options.resolution,
    duration: options.duration,
    generateAudio: capabilities.supportsAudioToggle
      ? options.generateAudio
      : undefined,
    ...assigned,
  }
}
