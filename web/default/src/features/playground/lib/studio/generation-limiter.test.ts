import { describe, expect, it } from 'vitest'

import { createGenerationLimiter } from './generation-limiter'

function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('createGenerationLimiter', () => {
  it('holds tasks beyond the limit and starts them in FIFO order as slots free up', async () => {
    const limiter = createGenerationLimiter(2)
    const gates = [deferred(), deferred(), deferred()]
    const started: number[] = []
    const results = gates.map((gate, index) =>
      limiter.schedule(async () => {
        started.push(index)
        await gate.promise
        return index
      })
    )

    expect(started).toEqual([0, 1])
    expect(limiter.active).toBe(2)

    gates[1].resolve()
    await results[1]
    expect(started).toEqual([0, 1, 2])

    gates[0].resolve()
    gates[2].resolve()
    await expect(Promise.all(results)).resolves.toEqual([0, 1, 2])
    expect(limiter.active).toBe(0)
  })

  it('frees the slot when a task rejects', async () => {
    const limiter = createGenerationLimiter(1)
    const failed = limiter.schedule(() => Promise.reject(new Error('boom')))
    const next = limiter.schedule(() => Promise.resolve('ok'))
    await expect(failed).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ok')
  })
})
