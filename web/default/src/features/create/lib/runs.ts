import type { PlaygroundRun } from '@/features/playground/api'
import type { StudioRunSummary } from '@/features/playground/lib/session/session-types'

/** Server run row as the feed and tile components read it. */
export function runToSummary(run: PlaygroundRun): StudioRunSummary {
  return {
    id: run.id,
    model: run.model,
    prompt: run.prompt,
    resultUrl: run.result_url || undefined,
    assetId: run.asset_id || undefined,
    taskId: run.task_id || undefined,
    batchId: run.batch_id || undefined,
    createdAt: run.created_at ? run.created_at * 1000 : undefined,
  }
}
