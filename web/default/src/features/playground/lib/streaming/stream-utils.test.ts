import { describe, expect, it } from 'vitest'

import { parseStreamMessageUpdates } from './stream-utils'

function chunkWithDelta(delta: Record<string, unknown>): string {
  return JSON.stringify({
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-4o',
    choices: [{ index: 0, delta, finish_reason: null }],
  })
}

describe('parseStreamMessageUpdates', () => {
  it('surfaces tool-call deltas alongside content', () => {
    const updates = parseStreamMessageUpdates(
      chunkWithDelta({
        content: 'Let me check.',
        tool_calls: [
          { index: 0, id: 'call_1', function: { name: 'web_search' } },
        ],
      })
    )

    expect(updates).toEqual([
      { type: 'content', chunk: 'Let me check.' },
      {
        type: 'tool_calls',
        deltas: [{ index: 0, id: 'call_1', function: { name: 'web_search' } }],
      },
    ])
  })

  it('ignores empty tool-call arrays', () => {
    const updates = parseStreamMessageUpdates(
      chunkWithDelta({ tool_calls: [] })
    )

    expect(updates).toEqual([])
  })
})
