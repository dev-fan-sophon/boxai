/**
 * Per-model image contract served by `GET /api/playground/image-capabilities`
 * (backend: relay/common/image_capabilities.go). Every list is also enforced
 * by the relay validator, so the studio only offers values the gateway
 * accepts and only sends fields the model family supports.
 */

export type ImageModelFamily = 'gpt-image' | 'xai' | 'gemini'
export type ImageSizeMode = 'pixels' | 'aspect'

export type ImageModelCapabilities = {
  family: ImageModelFamily
  modes: string[]
  maxReferenceImages: number
  sizeMode: ImageSizeMode
  sizes: string[]
  aspectRatios: string[]
  resolutions: string[]
  qualities: string[]
  maxN: number
  supportsMask: boolean
  backgrounds: string[]
  outputFormats: string[]
  moderation: string[]
  defaults: {
    size?: string
    aspectRatio?: string
    resolution?: string
    quality?: string
    background?: string
    outputFormat?: string
  }
}

/** Studio settings an image request is resolved from. */
export type ImageOptionSettings = {
  imageSize: string
  imageQuality: string
  imageAspectRatio: string
  imageResolution: string
  imageBackground: string
  imageOutputFormat: string
}

/** The concrete options one request will send; absent = not sent. */
export type ResolvedImageOptions = {
  size?: string
  aspectRatio?: string
  resolution?: string
  quality?: string
  background?: string
  outputFormat?: string
}

const FAMILIES = new Set<string>(['gpt-image', 'xai', 'gemini'])

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/** Validates the endpoint payload; anything malformed reads as unmodeled. */
export function parseImageCapabilities(
  data: unknown
): ImageModelCapabilities | null {
  if (!data || typeof data !== 'object') return null
  const raw = data as Record<string, unknown>
  if (typeof raw.family !== 'string' || !FAMILIES.has(raw.family)) return null
  if (raw.sizeMode !== 'pixels' && raw.sizeMode !== 'aspect') return null
  const maxReferenceImages = Number(raw.maxReferenceImages)
  const maxN = Number(raw.maxN)
  if (!Number.isFinite(maxReferenceImages) || !Number.isFinite(maxN)) {
    return null
  }
  const defaults =
    raw.defaults && typeof raw.defaults === 'object'
      ? (raw.defaults as Record<string, unknown>)
      : {}
  return {
    family: raw.family as ImageModelFamily,
    modes: stringList(raw.modes),
    maxReferenceImages: Math.max(0, Math.floor(maxReferenceImages)),
    sizeMode: raw.sizeMode,
    sizes: stringList(raw.sizes),
    aspectRatios: stringList(raw.aspectRatios),
    resolutions: stringList(raw.resolutions),
    qualities: stringList(raw.qualities),
    maxN: Math.max(1, Math.floor(maxN)),
    supportsMask: raw.supportsMask === true,
    backgrounds: stringList(raw.backgrounds),
    outputFormats: stringList(raw.outputFormats),
    moderation: stringList(raw.moderation),
    defaults: {
      size: optionalString(defaults.size),
      aspectRatio: optionalString(defaults.aspectRatio),
      resolution: optionalString(defaults.resolution),
      quality: optionalString(defaults.quality),
      background: optionalString(defaults.background),
      outputFormat: optionalString(defaults.outputFormat),
    },
  }
}

/**
 * Returns the allow-list spelling of `value` (case-insensitive), else the
 * fallback when it is allowed, else the first option, else undefined.
 */
export function pickImageOption(
  value: string | undefined,
  options: string[],
  fallback?: string
): string | undefined {
  const wanted = value?.trim().toLowerCase()
  const match = options.find((option) => option.toLowerCase() === wanted)
  if (match) return match
  if (fallback && options.includes(fallback)) return fallback
  return options[0]
}

/**
 * Clamps the stored studio settings onto what the model supports. Settings
 * stay untouched in the store, so switching back to a richer model restores
 * the user's choice.
 */
export function resolveImageOptions(
  capabilities: ImageModelCapabilities,
  settings: ImageOptionSettings
): ResolvedImageOptions {
  const defaults = capabilities.defaults
  const options: ResolvedImageOptions = {
    quality: pickImageOption(
      settings.imageQuality,
      capabilities.qualities,
      defaults.quality
    ),
  }
  if (capabilities.sizeMode === 'pixels') {
    options.size = pickImageOption(
      settings.imageSize,
      capabilities.sizes,
      defaults.size
    )
    options.background = pickImageOption(
      settings.imageBackground,
      capabilities.backgrounds,
      defaults.background
    )
    options.outputFormat = pickImageOption(
      settings.imageOutputFormat,
      capabilities.outputFormats,
      defaults.outputFormat
    )
    // Transparency needs an alpha channel: JPEG would be rejected.
    if (
      options.background === 'transparent' &&
      options.outputFormat === 'jpeg'
    ) {
      options.outputFormat = capabilities.outputFormats.includes('png')
        ? 'png'
        : undefined
    }
    return options
  }
  options.aspectRatio = pickImageOption(
    settings.imageAspectRatio,
    capabilities.aspectRatios,
    defaults.aspectRatio
  )
  options.resolution = pickImageOption(
    settings.imageResolution,
    capabilities.resolutions,
    defaults.resolution
  )
  return options
}

/** "1k" → "1K", "2k" → "2K" for display. */
export function imageResolutionLabel(resolution: string): string {
  return resolution.toUpperCase()
}

/** Short label for a WxH size, e.g. "16:9 · 3840×2160". */
export function imagePixelSizeLabel(size: string): string {
  const match = /^(\d+)x(\d+)$/.exec(size)
  if (!match) return size
  const width = Number(match[1])
  const height = Number(match[2])
  let a = width
  let b = height
  while (b !== 0) {
    const rest = a % b
    a = b
    b = rest
  }
  return `${width / a}:${height / a} · ${width}×${height}`
}

/**
 * MIME type of a base64 image from its magic bytes; providers return PNG,
 * JPEG or WebP regardless of the data URL prefix we would otherwise assume.
 */
export function imageMimeFromBase64(base64: string, fallback = 'png'): string {
  if (base64.startsWith('iVBOR')) return 'image/png'
  if (base64.startsWith('/9j/')) return 'image/jpeg'
  if (base64.startsWith('UklGR')) return 'image/webp'
  if (base64.startsWith('R0lGOD')) return 'image/gif'
  return `image/${fallback === 'jpg' ? 'jpeg' : fallback}`
}
