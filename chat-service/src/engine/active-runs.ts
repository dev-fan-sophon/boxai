type ActiveRun = {
  userId: number
  conversationId: number
  controller: AbortController
  snapshot: () => ActiveRunSnapshot
  settled: Promise<void>
  resolve: () => void
}

export type ActiveRunSnapshot = {
  content: string
  clientKey: string
  model: string
  source: string
}

const activeRuns = new Map<string, ActiveRun>()

export function registerActiveRun(
  runId: string,
  userId: number,
  conversationId: number,
  controller: AbortController,
  snapshot: () => ActiveRunSnapshot
): () => void {
  let resolve!: () => void
  const settled = new Promise<void>((done) => {
    resolve = done
  })
  activeRuns.set(runId, {
    userId,
    conversationId,
    controller,
    snapshot,
    settled,
    resolve,
  })
  return () => {
    const active = activeRuns.get(runId)
    if (active?.controller !== controller) return
    activeRuns.delete(runId)
    active.resolve()
  }
}

export async function abortActiveRun(
  runId: string,
  userId: number,
  conversationId: number
): Promise<boolean> {
  const active = activeRuns.get(runId)
  if (
    !active ||
    active.userId !== userId ||
    active.conversationId !== conversationId
  ) {
    return false
  }
  active.controller.abort(new Error('generation stopped by user'))
  await Promise.race([
    active.settled,
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ])
  return true
}

export function snapshotActiveRun(
  runId: string,
  userId: number,
  conversationId: number
): ActiveRunSnapshot | null {
  const active = activeRuns.get(runId)
  if (
    !active ||
    active.userId !== userId ||
    active.conversationId !== conversationId
  ) {
    return null
  }
  return active.snapshot()
}

export function releaseActiveRun(
  runId: string,
  userId: number,
  conversationId: number
): boolean {
  const active = activeRuns.get(runId)
  if (
    !active ||
    active.userId !== userId ||
    active.conversationId !== conversationId
  ) {
    return false
  }
  activeRuns.delete(runId)
  active.resolve()
  return true
}
