import type { StudioSettings } from '../../types'
import type { StudioRunSummary } from '../session/session-types'
import type { AudioKind } from './model-modality'

/**
 * A card on the studio feed: one submit (a batch of jobs) with its finished
 * runs and the jobs still queued, running, or failed. Persisted runs carry
 * the batch id; legacy runs without one are re-grouped by prompt and time.
 */
export type StudioFeedBatch = {
  key: string
  batchId?: string
  /** First prompt of the batch; `prompts` lists every distinct one. */
  prompt: string
  prompts: string[]
  model?: string
  createdAt?: number
  runs: StudioRunSummary[]
  pending: PendingStudioRun[]
  /** Settings snapshot of the submit, known while jobs are still pending. */
  settings?: StudioSettings
}

/** Legacy runs created within this window with the same prompt share a card. */
const BATCH_WINDOW_MS = 90_000

export function groupRunsIntoBatches(
  runs: StudioRunSummary[] | undefined
): StudioFeedBatch[] {
  if (!runs || runs.length === 0) return []
  const batches: StudioFeedBatch[] = []
  const byBatchId = new Map<string, StudioFeedBatch>()
  for (const run of runs) {
    const prompt = run.prompt?.trim() ?? ''
    if (run.batchId) {
      const existing = byBatchId.get(run.batchId)
      if (existing) {
        existing.runs.push(run)
        if (!existing.prompts.includes(prompt)) existing.prompts.push(prompt)
        continue
      }
      const batch: StudioFeedBatch = {
        key: `batch:${run.batchId}`,
        batchId: run.batchId,
        prompt,
        prompts: [prompt],
        model: run.model,
        createdAt: run.createdAt,
        runs: [run],
        pending: [],
      }
      byBatchId.set(run.batchId, batch)
      batches.push(batch)
      continue
    }
    const previous = batches.at(-1)
    const sameBatch =
      previous != null &&
      previous.batchId == null &&
      previous.prompt === prompt &&
      isWithinBatchWindow(previous.createdAt, run.createdAt)
    if (sameBatch && previous) {
      previous.runs.push(run)
      continue
    }
    batches.push({
      key: `b${batches.length}-${run.id}`,
      prompt,
      prompts: [prompt],
      model: run.model,
      createdAt: run.createdAt,
      runs: [run],
      pending: [],
    })
  }
  return batches
}

function isWithinBatchWindow(a?: number, b?: number): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return Math.abs(b - a) <= BATCH_WINDOW_MS
}

/**
 * Merges in-flight jobs into their batch card so a 10-image submit stays one
 * card while results stream in. Cards are ordered by when they started.
 */
export function buildStudioFeed(
  runs: StudioRunSummary[] | undefined,
  pending: PendingStudioRun[]
): StudioFeedBatch[] {
  const batches = groupRunsIntoBatches(runs)
  const byBatchId = new Map(
    batches.flatMap((batch) => (batch.batchId ? [[batch.batchId, batch]] : []))
  )
  for (const job of pending) {
    const prompt = job.input.prompt.trim()
    let batch = byBatchId.get(job.input.batchId)
    if (!batch) {
      batch = {
        key: `batch:${job.input.batchId}`,
        batchId: job.input.batchId,
        prompt,
        prompts: [],
        model: job.input.model,
        createdAt: job.queuedAt,
        runs: [],
        pending: [],
      }
      byBatchId.set(job.input.batchId, batch)
      batches.push(batch)
    }
    batch.pending.push(job)
    batch.settings ??= job.settings
    if (!batch.prompts.includes(prompt)) batch.prompts.push(prompt)
    if (batch.createdAt == null || job.queuedAt < batch.createdAt) {
      batch.createdAt = job.queuedAt
    }
  }
  // Legacy runs may lack timestamps; they inherit the previous card's time
  // so every card has a key and the comparator stays a total order.
  let previousKey = Number.NEGATIVE_INFINITY
  return batches
    .map((batch, index) => {
      const key = batch.createdAt ?? previousKey
      previousKey = key
      return { batch, index, key }
    })
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.batch)
}

/** `1024x1536` or `9:16` → width / height; undefined for auto/adaptive. */
export function ratioFromSize(size?: string): number | undefined {
  const match = /^(\d+)\s*[x×:]\s*(\d+)$/i.exec(size?.trim() ?? '')
  if (!match) return undefined
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? width / height : undefined
}

/**
 * Unique local id for runs that could not be linked to a cloud run (offline,
 * API failure). Negative so it can never collide with server ids.
 */
let localRunCounter = 0
export function createLocalRunId(): number {
  localRunCounter += 1
  return -(Date.now() * 1000 + (localRunCounter % 1000))
}

export type StudioGenerationInput = {
  modality: 'image' | 'video' | 'audio'
  /** Session the results belong to, captured at submit time. */
  sessionId: string
  /** Every job of one submit shares this id and renders as one card. */
  batchId: string
  prompt: string
  model: string
  group: string
  /** Data URLs for image/video references. Video roles are assigned at submit. */
  references: string[]
  /** Typed video references (references mode); asset or https URLs. */
  referenceVideos?: string[]
  /** Typed audio references (references mode); asset or https URLs. */
  referenceAudios?: string[]
  /**
   * Audio jobs: the sub-tool and route resolved from the model's catalog
   * metadata at submit (`native` = ElevenLabs passthrough). Audio inputs of
   * file-based tools travel in `references`.
   */
  audio?: { tool: AudioKind; native: boolean; inputName?: string }
  /** Image inpainting mask (PNG data URL) applied to the first reference. */
  mask?: string
}

export type StudioJobStatus = 'queued' | 'running' | 'error'

/** One job of a batch that has not produced its run yet. */
export type PendingStudioRun = {
  clientId: string
  input: StudioGenerationInput
  /** Settings snapshot taken when the batch was submitted. */
  settings: StudioSettings
  queuedAt: number
  /** Set when the job leaves the queue and its request starts. */
  startedAt?: number
  status: StudioJobStatus
  error?: string
  errorCode?: string
}
