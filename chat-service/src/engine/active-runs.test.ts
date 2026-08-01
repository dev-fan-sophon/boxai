import { describe, expect, test } from 'bun:test'

import {
  abortActiveRun,
  registerActiveRun,
  releaseActiveRun,
  snapshotActiveRun,
} from './active-runs'

describe('active agent run cancellation', () => {
  test('aborts only the owner-scoped run and waits for settlement', async () => {
    const controller = new AbortController()
    const unregister = registerActiveRun('run-1', 7, 11, controller, () => ({
      content: 'partial',
      clientKey: 'assistant',
      model: 'test-model',
      source: 'web',
    }))
    controller.signal.addEventListener('abort', unregister, { once: true })

    expect(await abortActiveRun('run-1', 8, 11)).toBe(false)
    expect(controller.signal.aborted).toBe(false)
    expect(await abortActiveRun('run-1', 7, 11)).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(await abortActiveRun('run-1', 7, 11)).toBe(false)
  })

  test('exposes and releases an owner-scoped partial snapshot', () => {
    const controller = new AbortController()
    registerActiveRun('run-2', 7, 11, controller, () => ({
      content: 'partial answer',
      clientKey: 'assistant-2',
      model: 'test-model',
      source: 'web',
    }))

    expect(snapshotActiveRun('run-2', 8, 11)).toBeNull()
    expect(snapshotActiveRun('run-2', 7, 11)?.content).toBe('partial answer')
    expect(releaseActiveRun('run-2', 8, 11)).toBe(false)
    expect(releaseActiveRun('run-2', 7, 11)).toBe(true)
    expect(snapshotActiveRun('run-2', 7, 11)).toBeNull()
  })
})
