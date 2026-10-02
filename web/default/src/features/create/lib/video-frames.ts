/** How long a frame capture may take before it is abandoned. */
const CAPTURE_TIMEOUT_MS = 30_000

/**
 * Draws the final frame of a video into a PNG. The source must be
 * same-origin or CORS-enabled, otherwise the canvas is tainted and the
 * export fails.
 */
export function captureVideoLastFrame(src: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    let timer = 0
    let settled = false
    const finish = (error: Error | null, blob?: Blob) => {
      // Releasing the source can fire one more error event.
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      if (error || !blob) reject(error ?? new Error('Empty frame'))
      else resolve(blob)
    }
    timer = window.setTimeout(
      () => finish(new Error('Frame capture timed out')),
      CAPTURE_TIMEOUT_MS
    )
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.addEventListener('error', () =>
      finish(new Error('Could not load the video'))
    )
    video.addEventListener('loadedmetadata', () => {
      // Seeking exactly to the end can land past the last decodable frame.
      video.currentTime = Math.max(0, video.duration - 0.05)
    })
    video.addEventListener('seeked', () => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context || canvas.width === 0) {
        finish(new Error('Could not read the video frame'))
        return
      }
      context.drawImage(video, 0, 0)
      try {
        canvas.toBlob((blob) => finish(null, blob ?? undefined), 'image/png')
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
    video.src = src
  })
}
