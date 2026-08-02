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

  it('deduplicates sources returned by repeated search tool calls', () => {
    const projected = agentUIMessageToPlayground(
      {
        id: 'assistant-search',
        role: 'assistant',
        parts: [
          {
            type: 'tool-web_search',
            toolCallId: 'search-1',
            state: 'output-available',
            input: { query: 'Vietnam AI news' },
            output: {
              sources: [{ href: 'https://news.example/story', title: 'Story' }],
            },
          },
          {
            type: 'tool-web_search',
            toolCallId: 'search-2',
            state: 'output-available',
            input: { query: 'Vietnam AI policy' },
            output: {
              sources: [
                { href: 'https://news.example/story', title: 'Story again' },
              ],
            },
          },
        ],
      },
      true
    )
    expect(projected.sources).toEqual([
      { href: 'https://news.example/story', title: 'Story', domain: undefined },
    ])
  })
})
