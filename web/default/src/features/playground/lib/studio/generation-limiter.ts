/**
 * FIFO concurrency gate for generation jobs. A 10-image batch should not open
 * ten upstream requests at once (provider rate limits, browser connection
 * caps), but it must keep the pipe full so results stream in steadily.
 */
export type GenerationLimiter = {
  /** Resolves with the task's result once a slot frees up and it has run. */
  schedule: <T>(task: () => Promise<T>) => Promise<T>
  /** Tasks currently holding a slot. */
  readonly active: number
}

export function createGenerationLimiter(
  concurrency: number
): GenerationLimiter {
  const limit = Math.max(1, Math.floor(concurrency))
  const waiting: Array<() => void> = []
  let active = 0

  const release = () => {
    active -= 1
    const next = waiting.shift()
    if (next) next()
  }

  return {
    get active() {
      return active
    },
    schedule<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        // The slot is released before the caller hears back, so work queued
        // behind this task starts in the same tick the caller resumes.
        const run = async () => {
          active += 1
          try {
            const value = await task()
            release()
            resolve(value)
          } catch (error) {
            release()
            reject(error)
          }
        }
        if (active < limit) {
          void run()
        } else {
          waiting.push(() => void run())
        }
      })
    },
  }
}

/** Shared per-modality gates so the studio and the canvas share one budget. */
export const studioGenerationLimiters = {
  image: createGenerationLimiter(5),
  video: createGenerationLimiter(4),
  audio: createGenerationLimiter(3),
}
