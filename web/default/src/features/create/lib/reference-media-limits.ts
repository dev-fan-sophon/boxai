import { t } from 'i18next'

/**
 * Pixel-count window Volcengine enforces on Seedance reference videos
 * (InvalidParameter.PixelCountTooSmall / TooLarge): 854×480 up to 4K.
 * Checked before upload so the run does not fail after it was queued.
 */
const SEEDANCE_REFERENCE_VIDEO_PIXELS = { min: 407_696, max: 8_295_044 }

function readVideoSize(
  file: File
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const done = (size: { width: number; height: number } | null) => {
      URL.revokeObjectURL(url)
      resolve(size)
    }
    video.preload = 'metadata'
    video.addEventListener('loadedmetadata', () =>
      done({ width: video.videoWidth, height: video.videoHeight })
    )
    video.addEventListener('error', () => done(null))
    video.src = url
  })
}

/** Returns a user-facing reason when Seedance will reject this reference video. */
export async function seedanceReferenceVideoIssue(
  file: File
): Promise<string | null> {
  const size = await readVideoSize(file)
  // Unreadable metadata is left to the provider rather than blocked here.
  if (!size || size.width === 0 || size.height === 0) return null
  const pixels = size.width * size.height
  const limits = SEEDANCE_REFERENCE_VIDEO_PIXELS
  if (pixels >= limits.min && pixels <= limits.max) return null
  if (pixels < limits.min) {
    return t(
      'Reference video {{width}}×{{height}} is too small. Seedance needs at least 854×480 (720p or larger recommended).',
      { width: size.width, height: size.height }
    )
  }
  return t(
    'Reference video {{width}}×{{height}} is too large. Seedance accepts up to 4K (3840×2160).',
    { width: size.width, height: size.height }
  )
}
