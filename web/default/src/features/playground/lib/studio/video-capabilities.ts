/** Server-authoritative video generation capabilities. */

import { t } from 'i18next'

import type { VideoCapabilities } from '../../hooks/use-video-capabilities'
import type { StudioSettings } from '../../types'
import { clampBatchCount } from './batch-plan'

export type VideoAspectRatio =
  | '16:9'
  | '9:16'
  | '1:1'
  | '4:3'
  | '3:4'
  | '3:2'
  | '2:3'
  | '21:9'
  | 'adaptive'
export type VideoResolution = '480p' | '720p' | '1080p'
export type VideoReferenceMode = 'frames' | 'references'

export type VideoModelCapabilities = {
  family: 'seedance-2' | 'seedance-2-fast' | 'seedance-2.5' | 'xai' | 'generic'
  aspectRatios: VideoAspectRatio[]
  resolutions: VideoResolution[]
  resolutionAspectRatios?: Partial<Record<VideoResolution, VideoAspectRatio[]>>
  /** Resolutions that the provider only accepts for image-to-video runs. */
  imageOnlyResolutions: VideoResolution[]
  durations: number[]
  durationRange: { min: number; max: number }
  defaults: {
    aspectRatio: VideoAspectRatio
    resolution: VideoResolution
    duration: number
  }
  /** Maximum images in `references` mode; 1 means the model has no reference mode. */
  maxReferenceImages: number
  /** Maximum typed reference videos / audios in `references` mode (absent: 0). */
  maxReferenceVideos?: number
  maxReferenceAudios?: number
  /** Reference audio needs at least one reference image or video. */
  audioReferenceRequiresVisual?: boolean
  supportsLastFrame: boolean
  requiresImage: boolean
  /** Sends `metadata.generate_audio` (Seedance and xAI Imagine 1.5). */
  supportsAudioToggle: boolean
  /** Emits Volcengine `metadata.{resolution,ratio,generate_audio}` alongside `size`. */
  usesVolcengineMetadata: boolean
  /** Volcengine-only `metadata.seed` / `metadata.watermark`. */
  supportsSeed?: boolean
  supportsWatermark?: boolean
  /** The provider can return the final frame (`metadata.return_last_frame`). */
  returnsLastFrame?: boolean
}

/** Ark seed bounds: -1 (random) to 2^32 - 1. */
export const MAX_VIDEO_SEED = 4294967295

/** Every whole-second duration the model accepts, or its presets when the range is wide. */
export function videoDurationOptions(
  capabilities: VideoModelCapabilities
): number[] {
  const { min, max } = capabilities.durationRange
  if (max - min > 30) return capabilities.durations
  return Array.from({ length: max - min + 1 }, (_, index) => min + index)
}

/** How many attached images the current server profile accepts. */
export function getActiveVideoReferenceLimit(input: {
  capabilities: VideoModelCapabilities
  referenceMode: VideoReferenceMode
  disableLastFrame?: boolean
}): number {
  const capabilities = input.capabilities
  if (input.referenceMode === 'references') {
    return capabilities.maxReferenceImages
  }
  if (capabilities.supportsLastFrame && !input.disableLastFrame) return 2
  return 1
}

/**
 * Nominal `WxH` for a ratio/resolution pair. The Seedance passthrough ignores
 * this in favour of `metadata.{resolution,ratio}`; native adaptors (xAI, Kling,
 * Veo) read it directly, so the 16:9 / 9:16 values match their fixed sizes.
 */
const SIZE_TABLE: Record<
  VideoResolution,
  Partial<Record<Exclude<VideoAspectRatio, 'adaptive'>, string>>
> = {
  '480p': {
    '16:9': '864x480',
    '9:16': '480x864',
    '1:1': '480x480',
    '4:3': '640x480',
    '3:4': '480x640',
    '3:2': '720x480',
    '2:3': '480x720',
    '21:9': '1120x480',
  },
  '720p': {
    '16:9': '1280x720',
    '9:16': '720x1280',
    '1:1': '720x720',
    '4:3': '960x720',
    '3:4': '720x960',
    '3:2': '1080x720',
    '2:3': '720x1080',
    '21:9': '1680x720',
  },
  '1080p': {
    '16:9': '1920x1080',
    '9:16': '1080x1920',
    '1:1': '1080x1080',
    '4:3': '1440x1080',
    '3:4': '1080x1440',
    '3:2': '1620x1080',
    '2:3': '1080x1620',
    '21:9': '2520x1080',
  },
}

export function videoSizeForOptions(
  aspectRatio: VideoAspectRatio,
  resolution: VideoResolution
): string | undefined {
  if (aspectRatio === 'adaptive') return undefined
  return SIZE_TABLE[resolution][aspectRatio]
}

export function videoResolutionsForRatio(
  capabilities: VideoModelCapabilities,
  ratio: VideoAspectRatio
): VideoResolution[] {
  return capabilities.resolutions.filter((resolution) => {
    const ratios = capabilities.resolutionAspectRatios?.[resolution]
    return !ratios || ratios.includes(ratio)
  })
}

/** Inverse of `videoSizeForOptions` for legacy `size` metadata. */
export function videoOptionsFromSize(
  size: string | undefined
): { aspectRatio: VideoAspectRatio; resolution: VideoResolution } | undefined {
  if (!size) return undefined
  for (const resolution of Object.keys(SIZE_TABLE) as VideoResolution[]) {
    const ratios = SIZE_TABLE[resolution]
    for (const ratio of Object.keys(ratios) as Array<keyof typeof ratios>) {
      if (ratios[ratio] === size) return { aspectRatio: ratio, resolution }
    }
  }
  return undefined
}

export type VideoGenerationOptions = {
  aspectRatio: VideoAspectRatio
  resolution: VideoResolution
  duration: number
  generateAudio: boolean
  referenceMode: VideoReferenceMode
  count: number
}

/** Picks an image-taking profile solely for attachment limits and controls. */
export function getVideoUploadProfile(
  profiles: VideoCapabilities | undefined,
  preferredMode: VideoReferenceMode
):
  | { mode: VideoReferenceMode; capabilities: VideoModelCapabilities }
  | undefined {
  const preferred = profiles?.[preferredMode]
  if (preferred) return { mode: preferredMode, capabilities: preferred }
  if (profiles?.frames) return { mode: 'frames', capabilities: profiles.frames }
  if (profiles?.references) {
    return { mode: 'references', capabilities: profiles.references }
  }
  return undefined
}

/**
 * Clamps a (possibly stale) selection to what the model supports. Metadata
 * written for one model stays valid after the user switches to another.
 */
export function resolveVideoOptions(
  capabilities: VideoModelCapabilities,
  selection: {
    aspectRatio?: string
    resolution?: string
    seconds?: string | number
    size?: string
    generateAudio?: boolean
    referenceMode?: string
    count?: number
  },
  context: {
    hasImage: boolean
    mode?: 'text' | 'frames' | 'references'
  } = { hasImage: true }
): VideoGenerationOptions {
  const legacy = videoOptionsFromSize(selection.size)
  const requestedRatio = (selection.aspectRatio ??
    legacy?.aspectRatio ??
    capabilities.defaults.aspectRatio) as VideoAspectRatio
  const aspectRatio = capabilities.aspectRatios.includes(requestedRatio)
    ? requestedRatio
    : capabilities.defaults.aspectRatio

  const requestedResolution = (selection.resolution ??
    legacy?.resolution ??
    capabilities.defaults.resolution) as VideoResolution
  const resolutions = videoResolutionsForRatio(capabilities, aspectRatio)
  let resolution = resolutions.includes(requestedResolution)
    ? requestedResolution
    : resolutions[0]
  if (
    !context.hasImage &&
    capabilities.imageOnlyResolutions.includes(resolution)
  ) {
    resolution = capabilities.defaults.resolution
  }

  const parsedDuration = Math.round(Number(selection.seconds))
  const duration = Number.isFinite(parsedDuration)
    ? Math.min(
        capabilities.durationRange.max,
        Math.max(capabilities.durationRange.min, parsedDuration)
      )
    : capabilities.defaults.duration

  const referenceMode: VideoReferenceMode =
    context.mode === 'references' ||
    (context.mode === undefined && selection.referenceMode === 'references')
      ? 'references'
      : 'frames'

  const count = clampBatchCount(selection.count ?? 1)

  return {
    aspectRatio,
    resolution,
    duration,
    generateAudio: capabilities.supportsAudioToggle
      ? selection.generateAudio !== false
      : false,
    referenceMode,
    count,
  }
}

export function assignVideoReferences(input: {
  capabilities: VideoModelCapabilities
  references: string[]
  referenceMode: VideoReferenceMode
  disableLastFrame?: boolean
}): {
  firstFrame?: string
  lastFrame?: string
  referenceImages?: string[]
} {
  const capabilities = input.capabilities
  const limit = getActiveVideoReferenceLimit(input)
  if (input.references.length > limit) {
    throw new Error(
      t('You can attach up to {{count}} images.', { count: limit })
    )
  }
  if (input.referenceMode === 'references') {
    return {
      referenceImages: input.references,
    }
  }
  const [firstFrame, secondFrame] = input.references
  const lastFrame =
    capabilities.supportsLastFrame && !input.disableLastFrame
      ? secondFrame
      : undefined
  return { firstFrame, lastFrame }
}

export function applyResolvedVideoSettings(
  settings: StudioSettings,
  capabilities: VideoModelCapabilities,
  patch: Partial<StudioSettings>,
  context: {
    hasImage: boolean
    mode?: 'text' | 'frames' | 'references'
  } = { hasImage: true }
): StudioSettings {
  const next = { ...settings, ...patch }
  const resolved = resolveVideoOptions(
    capabilities,
    {
      aspectRatio: next.videoAspectRatio,
      resolution: next.videoResolution,
      seconds: next.videoDuration,
      size: next.videoSize,
      generateAudio: next.videoGenerateAudio,
      referenceMode: next.videoReferenceMode,
      count: next.videoCount,
    },
    context
  )
  return {
    ...next,
    videoAspectRatio: resolved.aspectRatio,
    videoResolution: resolved.resolution,
    videoDuration: resolved.duration,
    videoSize:
      videoSizeForOptions(resolved.aspectRatio, resolved.resolution) ?? '',
    videoGenerateAudio: resolved.generateAudio,
    videoReferenceMode: resolved.referenceMode,
    videoCount: resolved.count,
  }
}
