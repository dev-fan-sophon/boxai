import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../../constants'
import type { Message } from '../../types'
import {
  MAX_CHAT_PAYLOAD_BYTES,
  buildChatCompletionPayload,
  VISUAL_OUTPUT_SYSTEM_PROMPT,
  isChatCompletionPayloadTooLarge,
} from './payload-builder'

// Stable marker from the platform base layer (lib/prompt/system-prompt.ts).
const PLATFORM_MARKER = 'You are BoxAI Assistant'

function userMessage(content: string, key = content): Message {
  return {
    key,
    from: 'user',
    versions: [{ id: `${key}-v`, content }],
    status: 'complete',
  }
}

function assistantMessage(content: string, key = content): Message {
  return {
    key,
    from: 'assistant',
    versions: [{ id: `${key}-v`, content }],
    status: 'complete',
  }
}

function systemContent(payload: {
  messages: { role: string; content: unknown }[]
}): string {
  expect(payload.messages[0]?.role).toBe('system')
  return String(payload.messages[0]?.content)
}

describe('buildChatCompletionPayload', () => {
  it('does not emit legacy search controls in ordinary chat payloads', () => {
    const payload = buildChatCompletionPayload(
      [userMessage('latest news')],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED
    )

    expect(payload).not.toHaveProperty('managed_tool_run_id')
    expect(payload).not.toHaveProperty('web_search')
    expect(payload).not.toHaveProperty('max_tool_loops')
    expect(payload).not.toHaveProperty('tools')
    expect(payload).not.toHaveProperty('tool_choice')
  })

  it('offers the web_search function tool only when requested', () => {
    const payload = buildChatCompletionPayload(
      [userMessage('latest news')],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED,
      { webSearchTool: true }
    )

    expect(payload.tool_choice).toBe('auto')
    expect(payload.tools).toHaveLength(1)
    expect(payload.tools?.[0].function.name).toBe('web_search')
  })

  it('always injects the platform base prompt, even without a persona', () => {
    const payload = buildChatCompletionPayload(
      [userMessage('hello')],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED,
      { systemPrompt: '   \n\t  ' }
    )
    const system = systemContent(payload)
    expect(system).toContain(PLATFORM_MARKER)
    expect(system).toContain('Current date and time:')
    expect(payload.messages.slice(1)).toEqual([
      { role: 'user', content: 'hello' },
    ])
  })

  it('names the answering model in the base prompt when provided', () => {
    const payload = buildChatCompletionPayload(
      [userMessage('hello')],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED,
      { modelName: 'gpt-5' }
    )
    expect(systemContent(payload)).toContain(
      'The model answering this conversation is gpt-5.'
    )
  })

  it('layers a trimmed persona after the platform base prompt', () => {
    const payload = buildChatCompletionPayload(
      [userMessage('hello'), assistantMessage('hi')],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED,
      { systemPrompt: '  You are helpful.  ', carryHistory: true }
    )
    const system = systemContent(payload)
    expect(system).toContain('You are helpful.')
    expect(system.indexOf(PLATFORM_MARKER)).toBeLessThan(
      system.indexOf('You are helpful.')
    )
    expect(payload.messages.slice(1)).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ])
  })

  it('keeps only the last user turn when carryHistory is false', () => {
    const payload = buildChatCompletionPayload(
      [
        userMessage('first', 'u1'),
        assistantMessage('reply', 'a1'),
        userMessage('second', 'u2'),
      ],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED,
      { carryHistory: false, systemPrompt: 'persona' }
    )
    expect(payload.messages).toHaveLength(2)
    expect(systemContent(payload)).toContain('persona')
    expect(payload.messages[1]).toEqual({ role: 'user', content: 'second' })
  })

  it('emits only the system message when history is empty', () => {
    const payload = buildChatCompletionPayload(
      [],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED,
      { carryHistory: false }
    )
    expect(payload.messages).toHaveLength(1)
    expect(systemContent(payload)).toContain(PLATFORM_MARKER)
  })

  it('appends the visual-output capability prompt when enabled', () => {
    const payload = buildChatCompletionPayload(
      [userMessage('hi')],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED,
      { systemPrompt: 'persona', visualOutput: true }
    )
    const system = systemContent(payload)
    expect(system).toContain(VISUAL_OUTPUT_SYSTEM_PROMPT)
    expect(system.indexOf(PLATFORM_MARKER)).toBeLessThan(
      system.indexOf(VISUAL_OUTPUT_SYSTEM_PROMPT)
    )
  })

  it('omits the visual-output prompt when disabled', () => {
    const payload = buildChatCompletionPayload(
      [userMessage('hi')],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED,
      { systemPrompt: 'persona', visualOutput: false }
    )
    expect(systemContent(payload)).not.toContain(VISUAL_OUTPUT_SYSTEM_PROMPT)
  })

  it('injects long-term memories as background facts', () => {
    const payload = buildChatCompletionPayload(
      [userMessage('hi')],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED,
      { memories: ['Lives in Hanoi', '  ', 'Prefers concise replies'] }
    )
    const system = systemContent(payload)
    expect(system).toContain('Long-term memory about this user')
    expect(system).toContain('- Lives in Hanoi')
    expect(system).toContain('- Prefers concise replies')
  })

  it('replaces summarized turns with the rolling summary block', () => {
    const payload = buildChatCompletionPayload(
      [
        userMessage('old question', 'u1'),
        assistantMessage('old answer', 'a1'),
        userMessage('new question', 'u2'),
      ],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED,
      { summary: 'They discussed X.', summaryTailKey: 'a1' }
    )
    expect(systemContent(payload)).toContain('They discussed X.')
    expect(payload.messages.slice(1)).toEqual([
      { role: 'user', content: 'new question' },
    ])
  })

  it('keeps full history when the summary tail key is missing', () => {
    const payload = buildChatCompletionPayload(
      [userMessage('one', 'u1'), userMessage('two', 'u2')],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED,
      { summary: 'stale summary', summaryTailKey: 'gone' }
    )
    expect(systemContent(payload)).not.toContain('stale summary')
    expect(payload.messages.slice(1)).toEqual([
      { role: 'user', content: 'one' },
      { role: 'user', content: 'two' },
    ])
  })

  it('never drops the entire history for a summary covering every turn', () => {
    const payload = buildChatCompletionPayload(
      [userMessage('only', 'u1')],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED,
      { summary: 'covers everything', summaryTailKey: 'u1' }
    )
    expect(systemContent(payload)).not.toContain('covers everything')
    expect(payload.messages.slice(1)).toEqual([
      { role: 'user', content: 'only' },
    ])
  })

  it('clamps oversized persona prompts before send', () => {
    const huge = 'x'.repeat(12_000)
    const payload = buildChatCompletionPayload(
      [userMessage('hi')],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED,
      { systemPrompt: huge }
    )
    expect(systemContent(payload)).toContain('x'.repeat(8000))
    expect(systemContent(payload)).not.toContain('x'.repeat(8001))
  })

  it('requests stream usage only for streaming payloads', () => {
    const streaming = buildChatCompletionPayload(
      [userMessage('hello')],
      { ...DEFAULT_CONFIG, stream: true },
      DEFAULT_PARAMETER_ENABLED
    )
    expect(streaming.stream_options).toEqual({ include_usage: true })

    const nonStreaming = buildChatCompletionPayload(
      [userMessage('hello')],
      { ...DEFAULT_CONFIG, stream: false },
      DEFAULT_PARAMETER_ENABLED
    )
    expect(nonStreaming).not.toHaveProperty('stream_options')
  })

  it('formats image and parsed PDF attachments as image_url plus text parts', () => {
    const message = userMessage('Compare these files')
    message.attachments = [
      {
        id: 'image-1',
        name: 'chart.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,aW1hZ2U=',
        kind: 'image',
      },
      {
        id: 'pdf-1',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        kind: 'document',
        text: 'Revenue up 12%',
        assetId: 9,
      },
    ]

    const payload = buildChatCompletionPayload(
      [message],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED
    )

    expect(payload.messages.slice(1)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Compare these files' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
          },
          {
            type: 'text',
            text: 'Attached document "report.pdf":\n\nRevenue up 12%',
          },
        ],
      },
    ])
  })

  it('sends extracted document text that has no binary payload', () => {
    const message = userMessage('Summarize')
    message.attachments = [
      {
        id: 'doc-1',
        name: 'plan.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        kind: 'document',
        text: 'Hire a CEO',
      },
    ]

    const payload = buildChatCompletionPayload(
      [message],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED
    )

    expect(payload.messages.slice(1)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Summarize' },
          {
            type: 'text',
            text: 'Attached document "plan.docx":\n\nHire a CEO',
          },
        ],
      },
    ])
  })
})

describe('isChatCompletionPayloadTooLarge', () => {
  it('rejects payloads above the request byte limit', () => {
    const payload = buildChatCompletionPayload(
      [userMessage('x'.repeat(MAX_CHAT_PAYLOAD_BYTES))],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED
    )

    expect(isChatCompletionPayloadTooLarge(payload)).toBe(true)
  })

  it('accepts normal payloads', () => {
    const payload = buildChatCompletionPayload(
      [userMessage('hello')],
      DEFAULT_CONFIG,
      DEFAULT_PARAMETER_ENABLED
    )

    expect(isChatCompletionPayloadTooLarge(payload)).toBe(false)
  })
})
