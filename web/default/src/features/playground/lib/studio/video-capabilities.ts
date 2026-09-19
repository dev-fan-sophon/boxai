/**
 * Per-model video generation capabilities.
 *
 * Option lists are driven by what the backend's upstream channels accept, not
 * by a generic UI list: the Seedance family (Volcengine via OpenAI-video
 * passthrough) takes resolution tiers, aspect ratios, 4–15 s (2.5: 4–30 s), an
 * audio toggle and role-based reference images; xAI `grok-imagine-video`
 * takes three fixed sizes, 1–15 s and exactly one image. Unknown video models
 * fall back to the conservative OpenAI-video profile.
 */

import type { StudioSettings } from '../../types'

export type VideoAspectRatio =
  | '16:9'
  | '9:16'
  | '1:1'
  | '4:3'
  | '3:4'
  | '21:9'
  | 'adaptive'
export type VideoResolution = '480p' | '720p' | '1080p'
export type VideoReferenceMode = 'frames' | 'references'

export type VideoModelCapabilities = {
  family: 'seedance-2' | 'seedance-2-fast' | 'seedance-2.5' | 'xai' | 'generic'
  aspectRatios: VideoAspectRatio[]
  resolutions: VideoResolution[]
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
  supportsLastFrame: boolean
  requiresImage: boolean
  supportsAudioToggle: boolean
  /** Emits Volcengine `metadata.{resolution,ratio,generate_audio}` alongside `size`. */
  usesVolcengineMetadata: boolean
}

export const MAX_VIDEO_BATCH_JOBS = 10
export const VIDEO_COUNTS = [1, 2, 3, 4] as const

const SEEDANCE_RATIOS: VideoAspectRatio[] = [
  '16:9',
  '9:16',
  '1:1',
  '4:3',
  '3:4',
  '21:9',
  'adaptive',
]

const SEEDANCE_2: VideoModelCapabilities = {
  family: 'seedance-2',
  aspectRatios: SEEDANCE_RATIOS,
  resolutions: ['480p', '720p', '1080p'],
  imageOnlyResolutions: [],
  durations: [4, 5, 6, 8, 10, 12, 15],
  durationRange: { min: 4, max: 15 },
  defaults: { aspectRatio: '16:9', resolution: '720p', duration: 5 },
  maxReferenceImages: 9,
  supportsLastFrame: true,
  requiresImage: false,
  supportsAudioToggle: true,
  usesVolcengineMetadata: true,
}

const SEEDANCE_2_FAST: VideoModelCapabilities = {
  ...SEEDANCE_2,
  family: 'seedance-2-fast',
  resolutions: ['480p', '720p'],
}

const SEEDANCE_2_5: VideoModelCapabilities = {
  ...SEEDANCE_2,
  family: 'seedance-2.5',
  durations: [4, 5, 6, 8, 10, 12, 15, 20, 25, 30],
  durationRange: { min: 4, max: 30 },
  maxReferenceImages: 30,
}

const XAI_IMAGINE: VideoModelCapabilities = {
  family: 'xai',
  aspectRatios: ['16:9', '9:16'],
  resolutions: ['720p', '1080p'],
  imageOnlyResolutions: ['1080p'],
  durations: [3, 5, 8, 10, 15],
  durationRange: { min: 1, max: 15 },
  defaults: { aspectRatio: '16:9', resolution: '720p', duration: 5 },
  maxReferenceImages: 1,
  supportsLastFrame: false,
  requiresImage: true,
  supportsAudioToggle: false,
  usesVolcengineMetadata: false,
}

const GENERIC: VideoModelCapabilities = {
  family: 'generic',
  aspectRatios: ['16:9', '9:16'],
  resolutions: ['720p', '1080p'],
  imageOnlyResolutions: [],
  durations: [4, 5, 8, 10, 12, 15, 20],
  durationRange: { min: 1, max: 60 },
  defaults: { aspectRatio: '16:9', resolution: '720p', duration: 5 },
  maxReferenceImages: 1,
  supportsLastFrame: true,
  requiresImage: false,
  supportsAudioToggle: false,
  usesVolcengineMetadata: false,
}

export function getVideoModelCapabilities(
  model: string | undefined
): VideoModelCapabilities {
  const name = (model ?? '').toLowerCase()
  if (/seedance-2[.-]5/.test(name)) return SEEDANCE_2_5
  if (/seedance-2[.-]0-fast|seedance-2[.-]0[.-]fast/.test(name)) {
    return SEEDANCE_2_FAST
  }
  if (/seedance-2[.-]0/.test(name)) return SEEDANCE_2
  if (/grok-imagine-video|grok-video/.test(name)) return XAI_IMAGINE
  return GENERIC
}

export function getVideoReferenceLimit(model: string): number {
  return getVideoModelCapabilities(model).maxReferenceImages
}

/** How many attached images this model will actually send for the current mode. */
export function getActiveVideoReferenceLimit(input: {
  model: string | undefined
  referenceMode: VideoReferenceMode
  disableLastFrame?: boolean
}): number {
  const capabilities = getVideoModelCapabilities(input.model)
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
    '21:9': '1120x480',
  },
  '720p': {
    '16:9': '1280x720',
    '9:16': '720x1280',
    '1:1': '720x720',
    '4:3': '960x720',
    '3:4': '720x960',
    '21:9': '1680x720',
  },
  '1080p': {
    '16:9': '1920x1080',
    '9:16': '1080x1920',
    '1:1': '1080x1080',
    '4:3': '1440x1080',
    '3:4': '1080x1440',
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
  context: { hasImage: boolean } = { hasImage: true }
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
  let resolution = capabilities.resolutions.includes(requestedResolution)
    ? requestedResolution
    : capabilities.defaults.resolution
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
    capabilities.maxReferenceImages > 1 &&
    selection.referenceMode === 'references'
      ? 'references'
      : 'frames'

  const count = Math.min(
    VIDEO_COUNTS.at(-1) ?? 1,
    Math.max(1, Math.round(selection.count ?? 1) || 1)
  )

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

/**
 * Splits a batch prompt box into individual prompts. One prompt per line;
 * blank lines are ignored. Callers cap the total at `MAX_VIDEO_BATCH_JOBS`.
 */
export function splitBatchPrompts(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export type VideoJobPlan = {
  /** Prompts in generation order. */
  prompts: string[]
  /** Jobs dropped because the batch exceeded `MAX_VIDEO_BATCH_JOBS`. */
  truncated: number
}

/**
 * Expands the composer/node prompt into the list of video jobs to run.
 * Batch mode treats every non-empty line as a prompt; `count` repeats each
 * prompt. The total is capped at `MAX_VIDEO_BATCH_JOBS`.
 */
export function assignVideoReferences(input: {
  model: string
  references: string[]
  referenceMode: VideoReferenceMode
  disableLastFrame?: boolean
}): {
  firstFrame?: string
  lastFrame?: string
  referenceImages?: string[]
} {
  const capabilities = getVideoModelCapabilities(input.model)
  if (
    input.referenceMode === 'references' &&
    capabilities.maxReferenceImages > 1
  ) {
    return {
      referenceImages: input.references.slice(
        0,
        capabilities.maxReferenceImages
      ),
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
  context: { hasImage: boolean } = { hasImage: true }
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
      videoSizeForOptions(resolved.aspectRatio, resolved.resolution) ??
      next.videoSize,
    videoGenerateAudio: resolved.generateAudio,
    videoReferenceMode: resolved.referenceMode,
    videoCount: resolved.count,
  }
}

export function planVideoJobs(input: {
  text: string
  batchMode: boolean
  count: number
}): VideoJobPlan {
  const basePrompts = input.batchMode
    ? splitBatchPrompts(input.text)
    : [input.text.trim()].filter(Boolean)
  const count = Math.min(
    VIDEO_COUNTS.at(-1) ?? 1,
    Math.max(1, Math.round(input.count) || 1)
  )
  const expanded = basePrompts.flatMap((prompt) =>
    Array.from({ length: count }, () => prompt)
  )
  if (!expanded.length) return { prompts: [], truncated: 0 }
  return {
    prompts: expanded.slice(0, MAX_VIDEO_BATCH_JOBS),
    truncated: Math.max(0, expanded.length - MAX_VIDEO_BATCH_JOBS),
  }
}
