import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  agentChatRequestBody,
  agentUIMessageToPlayground,
  attachmentFileParts,
  loadAgentConversation,
  shouldPollAgentRun,
} from './transport'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('agent chat attachment transport', () => {
  it('sends only stable private asset URLs to AI SDK', () => {
    expect(
      attachmentFileParts([
        {
          id: 'asset-7',
          name: 'report.pdf',
          mimeType: 'application/pdf',
          kind: 'document',
          text: '',
          assetId: 7,
        },
      ])
    ).toEqual([
      {
        type: 'file',
        filename: 'report.pdf',
        mediaType: 'application/pdf',
        url: '/api/playground/assets/7/content',
      },
    ])
  })

  it('rejects attachments that have not reached private asset storage', () => {
    expect(() =>
      attachmentFileParts([
        {
          id: 'bad',
          name: 'bad.pdf',
          mimeType: 'application/pdf',
          kind: 'document',
          text: 'browser-only text',
        },
      ])
    ).toThrow('was not uploaded')
  })
})

describe('agent chat request policy', () => {
  it('forwards history and tool controls to the server', () => {
    expect(
      agentChatRequestBody({
        conversationId: 3,
        model: 'test-model',
        group: 'default',
        system: 'system',
        carryHistory: false,
        longMemory: true,
        maxSteps: 4,
        toolMode: 'document',
        reasoning: 'high',
        expectedRevision: 9,
        trigger: 'regenerate-message',
        messageId: 'assistant-1',
        requestKey: '00000000-0000-4000-8000-000000000000',
      })
    ).toMatchObject({
      carryHistory: false,
      longMemory: true,
      maxSteps: 4,
      toolMode: 'document',
      reasoning: 'high',
      expectedRevision: 9,
      trigger: 'regenerate-message',
    })
  })

  it('polls only when a remote run outlives the local stream', () => {
    expect(shouldPollAgentRun('ready', 'run-1')).toBe(true)
    expect(shouldPollAgentRun('error', 'run-1')).toBe(true)
    expect(shouldPollAgentRun('streaming', 'run-1')).toBe(false)
    expect(shouldPollAgentRun('submitted', 'run-1')).toBe(false)
    expect(shouldPollAgentRun('ready', '')).toBe(false)
  })
})

describe('agent chat history adapters', () => {
  it('hydrates attachments and immutable revisions from server history', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            conversation: { id: 3, revision: 8 },
            messages: [
              {
                id: 11,
                conversation_id: 3,
                user_id: 2,
                role: 'user',
                content: 'summarize',
                content_json: JSON.stringify([
                  { type: 'text', text: 'summarize' },
                  {
                    type: 'file',
                    filename: 'report.pdf',
                    mediaType: 'application/pdf',
                    url: '/api/playground/assets/7/content',
                  },
                ]),
                model: 'test-model',
                client_key: 'user-1',
                status: 'complete',
                active_revision: 2,
                created_at: 100,
                updated_at: 101,
                revisions: [
                  {
                    revision: 1,
                    content: 'old prompt',
                    status: 'complete',
                    created_at: 90,
                  },
                  {
                    revision: 2,
                    content: 'summarize',
                    content_json: JSON.stringify([
                      { type: 'text', text: 'summarize' },
                      {
                        type: 'file',
                        filename: 'report.pdf',
                        mediaType: 'application/pdf',
                        url: '/api/playground/assets/7/content',
                      },
                    ]),
                    status: 'complete',
                    created_at: 101,
                  },
                ],
              },
            ],
          },
        })
      )
    )

    const loaded = await loadAgentConversation(3)
    expect(loaded.revision).toBe(8)
    expect(loaded.messages[0]?.parts).toEqual([
      { type: 'text', text: 'summarize' },
      {
        type: 'file',
        filename: 'report.pdf',
        mediaType: 'application/pdf',
        url: '/api/playground/assets/7/content',
      },
    ])

    const firstMessage = loaded.messages[0]
    if (!firstMessage) throw new Error('expected the server message to load')
    const projected = agentUIMessageToPlayground(firstMessage, false)
    expect(projected.attachments).toEqual([
      {
        id: 'asset-7-0',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        kind: 'document',
        text: '',
        assetId: 7,
        status: 'done',
      },
    ])
    expect(projected.activeVersion).toBe(1)
    expect(projected.versions.map((version) => version.id)).toEqual(['1', '2'])
  })

  it('preserves a stopped response as visibly partial', () => {
    const projected = agentUIMessageToPlayground(
      {
        id: 'assistant-stopped',
        role: 'assistant',
        parts: [{ type: 'text', text: 'partial answer' }],
        metadata: { status: 'stopped' },
      },
      false
    )
    expect(projected.status).toBe('stopped')
  })

  it('keeps the legacy tool payload when history has no native parts', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            conversation: { id: 3, revision: 2 },
            messages: [
              {
                id: 12,
                role: 'assistant',
                content: 'Legacy answer',
                content_json: '',
                tool_json: JSON.stringify({
                  reasoning: { content: 'Legacy reasoning' },
                  managedTool: {
                    action: 'web_search',
                    status: 'completed',
                  },
                }),
                client_key: 'assistant-legacy',
                status: 'complete',
              },
            ],
          },
        })
      )
    )

    const loaded = await loadAgentConversation(3)
    const message = loaded.messages[0]
    if (!message) throw new Error('expected the legacy message to load')
    const projected = agentUIMessageToPlayground(message, false)

    expect(projected.parts).toBeUndefined()
    expect(projected.reasoning?.content).toBe('Legacy reasoning')
    expect(projected.managedTool).toMatchObject({
      action: 'web_search',
      status: 'completed',
    })
  })

  it('falls back to the text mirror when persisted parts have no visible content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            conversation: { id: 3, revision: 1 },
            messages: [
              {
                id: 13,
                role: 'assistant',
                content: 'Recovered answer',
                content_json: JSON.stringify([{ type: 'step-start' }]),
                client_key: 'assistant-fallback',
                status: 'complete',
              },
            ],
          },
        })
      )
    )

    const loaded = await loadAgentConversation(3)
    const message = loaded.messages[0]
    if (!message) throw new Error('expected the fallback message to load')
    const projected = agentUIMessageToPlayground(message, false)

    expect(projected.parts).toBeUndefined()
    expect(projected.versions[0]?.content).toBe('Recovered answer')
  })

  it('preserves native reasoning, tool, and text parts in SDK order', () => {
    const parts = [
      {
        type: 'reasoning' as const,
        text: 'choose a source',
        state: 'done' as const,
      },
      {
        type: 'tool-web_search' as const,
        toolCallId: 'search-1',
        state: 'output-available' as const,
        input: { query: 'Vietnam AI news' },
        output: {
          sources: [{ href: 'https://news.example/story', title: 'Story' }],
        },
      },
      {
        type: 'reasoning' as const,
        text: 'review the result',
        state: 'done' as const,
      },
      { type: 'text' as const, text: 'Final answer', state: 'done' as const },
    ]
    const projected = agentUIMessageToPlayground(
      {
        id: 'assistant-search',
        role: 'assistant',
        parts,
      },
      true
    )
    expect(projected.parts).toBe(parts)
    expect(projected.parts?.map((part) => part.type)).toEqual([
      'reasoning',
      'tool-web_search',
      'reasoning',
      'text',
    ])
    expect(projected.reasoning).toBeUndefined()
    expect(projected.managedTools).toBeUndefined()
    expect(projected.sources).toBeUndefined()
    expect(projected.status).toBe('streaming')
  })

  it('keeps each native part state instead of deriving message-level state', () => {
    const projected = agentUIMessageToPlayground(
      {
        id: 'assistant-document-progress',
        role: 'assistant',
        parts: [
          {
            type: 'reasoning',
            text: 'draft the report',
            state: 'done',
          },
          {
            type: 'tool-generate_document',
            toolCallId: 'document-1',
            state: 'output-available',
            input: { request: 'Build a report' },
            output: {
              status: 'running',
              stage: 'Building the document',
              attempt: 2,
              totalAttempts: 3,
            },
            preliminary: true,
          },
        ],
      },
      true
    )
    expect(projected.parts?.[0]).toMatchObject({
      type: 'reasoning',
      state: 'done',
    })
    expect(projected.parts?.[1]).toMatchObject({
      type: 'tool-generate_document',
      state: 'output-available',
      preliminary: true,
    })
    expect(projected.isReasoningStreaming).toBeUndefined()
  })
})
