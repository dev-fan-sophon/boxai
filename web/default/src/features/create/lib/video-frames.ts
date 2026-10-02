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
    // Seeking exactly to the end can land past the last decodable frame;
    // a frame that still reads as blank is retried a little earlier.
    const offsets = [0.1, 0.5]
    let attempt = 0
    const seekNext = () => {
      video.currentTime = Math.max(0, video.duration - offsets[attempt])
    }
    const draw = () => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context || canvas.width === 0) {
        finish(new Error('Could not read the video frame'))
        return
      }
      context.drawImage(video, 0, 0)
      if (attempt < offsets.length - 1 && isBlankFrame(context, canvas)) {
        attempt += 1
        seekNext()
        return
      }
      try {
        canvas.toBlob((blob) => finish(null, blob ?? undefined), 'image/png')
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    video.addEventListener('loadedmetadata', seekNext)
    video.addEventListener('seeked', () => {
      // A seek can complete before the frame is decoded and presented;
      // drawing then yields a black image. Wait for the presented frame.
      const presented = () => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          draw()
          return
        }
        video.addEventListener('loadeddata', draw, { once: true })
      }
      if ('requestVideoFrameCallback' in video) {
        let done = false
        const once = () => {
          if (done) return
          done = true
          presented()
        }
        video.requestVideoFrameCallback(once)
        // Paused seeks do not always present a frame callback.
        window.setTimeout(once, 500)
        return
      }
      presented()
    })
    video.src = src
  })
}

/** True when a sampled frame is (almost) uniformly black. */
function isBlankFrame(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement
): boolean {
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const step = Math.max(4, Math.floor(data.length / 4 / 2000) * 4)
  let total = 0
  let samples = 0
  for (let index = 0; index < data.length; index += step) {
    total += data[index] + data[index + 1] + data[index + 2]
    samples += 1
  }
  return samples > 0 && total / samples / 3 < 3
}
