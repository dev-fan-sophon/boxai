import { describe, expect, test } from 'bun:test'

import { abortActiveRun, registerActiveRun } from './active-runs'

describe('active agent run cancellation', () => {
  test('aborts only the owner-scoped run and waits for settlement', async () => {
    const controller = new AbortController()
    const unregister = registerActiveRun('run-1', 7, 11, controller)
    controller.signal.addEventListener('abort', unregister, { once: true })

    expect(await abortActiveRun('run-1', 8, 11)).toBe(false)
    expect(controller.signal.aborted).toBe(false)
    expect(await abortActiveRun('run-1', 7, 11)).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(await abortActiveRun('run-1', 7, 11)).toBe(false)
  })
})
