import type { VideoSubmitInput } from '../../api'
import type { StudioSettings } from '../../types'
import { DEFAULT_STUDIO_SETTINGS } from '../storage/store-migration'
import {
  assignVideoReferences,
  resolveVideoOptions,
  type VideoModelCapabilities,
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
  referenceVideos?: string[]
  referenceAudios?: string[]
  capabilities?: VideoModelCapabilities
}): VideoSubmitInput {
  const capabilities = input.capabilities
  if (!capabilities) throw new Error('Video capabilities are unavailable.')
  const referenceMode = input.settings.videoReferenceMode
  // Video and audio references only exist in references mode.
  const referenceVideos =
    referenceMode === 'references' ? (input.referenceVideos ?? []) : []
  const referenceAudios =
    referenceMode === 'references' ? (input.referenceAudios ?? []) : []
  const hasMedia =
    input.references.length + referenceVideos.length + referenceAudios.length >
    0
  let mode: 'text' | 'frames' | 'references' = 'text'
  if (hasMedia) {
    mode = referenceMode === 'references' ? 'references' : 'frames'
  }
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
    {
      hasImage: hasMedia,
      mode,
    }
  )
  const assigned = assignVideoReferences({
    capabilities,
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
    seed:
      capabilities.supportsSeed && typeof input.settings.videoSeed === 'number'
        ? input.settings.videoSeed
        : undefined,
    watermark: capabilities.supportsWatermark
      ? input.settings.videoWatermark === true
      : undefined,
    capabilities,
    ...assigned,
    referenceVideos: referenceVideos.length ? referenceVideos : undefined,
    referenceAudios: referenceAudios.length ? referenceAudios : undefined,
  }
}
