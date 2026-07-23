import { describe, expect, it } from 'vitest'

import type { Message } from '../types'
import { updateManagedAssistant } from './managed-tools'

describe('updateManagedAssistant', () => {
  it('updates only the assistant belonging to the routed turn', () => {
    const messages = [
      { key: 'pending-a', from: 'assistant', versions: [], status: 'loading' },
      { key: 'pending-b', from: 'assistant', versions: [], status: 'loading' },
    ] as Message[]
    const result = updateManagedAssistant(messages, 'pending-a', {
      runId: 7,
      action: 'generate_image',
      status: 'completed',
    })

    expect(result[0].managedTool?.runId).toBe(7)
    expect(result[1]).toBe(messages[1])
  })
})
