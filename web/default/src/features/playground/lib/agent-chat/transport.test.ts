import { afterEach, describe, expect, it, vi } from 'vitest'

import { ERROR_MESSAGES } from '../../constants'
import { sendAgentChat, type AgentChatCallbacks } from './transport'

afterEach(() => {
  vi.unstubAllGlobals()
})

function callbacks(onError: (message: string) => void): AgentChatCallbacks {
  return {
    onConversationId: () => {},
    onAssistantId: () => {},
    onTextDelta: () => {},
    onReasoningDelta: () => {},
    onReasoningEnd: () => {},
    onToolCard: () => {},
    onSources: () => {},
    onError,
  }
}

const request = {
  model: 'test-model',
  messageKey: 'user-1',
  text: 'hello',
}

describe('sendAgentChat stream completion', () => {
  it('reports a clean EOF without the SSE completion marker', async () => {
    const onError = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('data: {"type":"text-delta","delta":"partial"}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        })
      )
    )

    await sendAgentChat({ request, callbacks: callbacks(onError) })

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(ERROR_MESSAGES.CONNECTION_CLOSED)
  })

  it('accepts a stream that ends with the completion marker', async () => {
    const onError = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('data: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        })
      )
    )

    await sendAgentChat({ request, callbacks: callbacks(onError) })

    expect(onError).not.toHaveBeenCalled()
  })
})
