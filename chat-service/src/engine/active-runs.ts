type ActiveRun = {
  userId: number
  conversationId: number
  controller: AbortController
  settled: Promise<void>
  resolve: () => void
}

const activeRuns = new Map<string, ActiveRun>()

export function registerActiveRun(
  runId: string,
  userId: number,
  conversationId: number,
  controller: AbortController
): () => void {
  let resolve!: () => void
  const settled = new Promise<void>((done) => {
    resolve = done
  })
  activeRuns.set(runId, {
    userId,
    conversationId,
    controller,
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
