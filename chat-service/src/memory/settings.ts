/**
 * Memory subsystem configuration. The gateway kept these in its admin
 * settings store; the chat service owns the pipeline now and reads them from
 * the environment, with the same defaults and clamps the Go side enforced.
 */

function intEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isInteger(parsed) ? parsed : fallback
}

function clamp(value: number, min: number, max: number, fallback: number) {
  return value < min || value > max ? fallback : value
}

export type MemorySettings = {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
  summaryEnabled: boolean
  extractEveryMessages: number
  maxMemories: number
  summaryTriggerMessages: number
  summaryKeepRecent: number
  timeoutSeconds: number
}

export function memorySettings(): MemorySettings {
  return {
    enabled: process.env.PLAYGROUND_MEMORY_ENABLED === 'true',
    baseUrl: process.env.PLAYGROUND_MEMORY_BASE_URL ?? '',
    apiKey: process.env.PLAYGROUND_MEMORY_API_KEY ?? '',
    model: process.env.PLAYGROUND_MEMORY_MODEL ?? '',
    summaryEnabled: process.env.PLAYGROUND_MEMORY_SUMMARY_ENABLED !== 'false',
    extractEveryMessages: clamp(
      intEnv('PLAYGROUND_MEMORY_EXTRACT_EVERY', 8),
      2,
      100,
      8
    ),
    maxMemories: clamp(intEnv('PLAYGROUND_MEMORY_MAX', 50), 1, 200, 50),
    summaryTriggerMessages: clamp(
      intEnv('PLAYGROUND_MEMORY_SUMMARY_TRIGGER', 24),
      8,
      500,
      24
    ),
    summaryKeepRecent: clamp(
      intEnv('PLAYGROUND_MEMORY_SUMMARY_KEEP', 12),
      4,
      100,
      12
    ),
    timeoutSeconds: clamp(intEnv('PLAYGROUND_MEMORY_TIMEOUT', 60), 1, 300, 60),
  }
}

export function memoryReady(settings: MemorySettings): boolean {
  return Boolean(
    settings.enabled && settings.baseUrl && settings.apiKey && settings.model
  )
}
