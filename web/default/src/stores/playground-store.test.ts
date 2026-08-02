import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function createWindowStub() {
  return {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
}

describe('resetAccountData', () => {
  it('removes account-owned sessions and drafts without resetting preferences', async () => {
    vi.useFakeTimers()
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    })
    vi.stubGlobal('window', createWindowStub())
    const { usePlaygroundStore } = await import('./playground-store')
    const before = usePlaygroundStore.getState()
    usePlaygroundStore.setState({
      sessions: [
        {
          id: 'previous-account-chat',
          serverId: 91,
          modality: 'chat',
          title: 'Private conversation',
          model: before.config.model,
          group: before.config.group,
          messages: [
            {
              key: 'secret-message',
              from: 'user',
              versions: [{ id: '1', content: 'account-owned content' }],
              status: 'complete',
            },
          ],
          kind: 'chat',
          isDraft: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeModality: 'chat',
      activeSessionByModality: { chat: 'previous-account-chat' },
      prefill: { prompt: 'account-owned draft', nonce: 1 },
    })

    usePlaygroundStore.getState().resetAccountData()

    const after = usePlaygroundStore.getState()
    expect(after.sessions).toHaveLength(1)
    expect(after.sessions[0]).toMatchObject({
      modality: 'chat',
      messages: [],
      isDraft: true,
    })
    expect(after.sessions[0]?.serverId).toBeUndefined()
    expect(after.activeSessionByModality.chat).toBe(after.sessions[0]?.id)
    expect(after.prefill).toBeNull()
    expect(after.config).toEqual(before.config)
    expect(after.chatTools).toEqual(before.chatTools)
    vi.runAllTimers()
  })
})

describe('openSession', () => {
  it('opens Duo conversations in the Duo workspace', async () => {
    vi.useFakeTimers()
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    })
    vi.stubGlobal('window', createWindowStub())
    const { usePlaygroundStore } = await import('./playground-store')
    const state = usePlaygroundStore.getState()
    usePlaygroundStore.setState({
      workspaceMode: 'model',
      sessions: [
        {
          id: 'duo-chat',
          serverId: 92,
          modality: 'chat',
          title: 'Duo conversation',
          model: state.config.model,
          group: state.config.group,
          messages: [],
          kind: 'duo',
          isDraft: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    usePlaygroundStore.getState().openSession('duo-chat')

    expect(usePlaygroundStore.getState().workspaceMode).toBe('duo')
    expect(usePlaygroundStore.getState().activeSessionByModality.chat).toBe(
      'duo-chat'
    )
    vi.runAllTimers()
  })
})

describe('selectModel', () => {
  it('shows the switch notice for a server-hydrated normal chat', async () => {
    vi.useFakeTimers()
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    })
    vi.stubGlobal('window', createWindowStub())
    const { usePlaygroundStore } = await import('./playground-store')
    const state = usePlaygroundStore.getState()
    usePlaygroundStore.setState({
      activeModality: 'chat',
      sessions: [
        {
          id: 'server-chat',
          serverId: 93,
          modality: 'chat',
          title: 'Server conversation',
          model: 'old-model',
          group: state.config.group,
          messages: [],
          kind: 'chat',
          isDraft: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeSessionByModality: { chat: 'server-chat' },
      modelSwitchNotice: null,
    })

    usePlaygroundStore.getState().selectModel('new-model', undefined, {
      switchModality: 'chat',
      hasActiveChatMessages: true,
    })

    expect(usePlaygroundStore.getState().modelSwitchNotice).toMatchObject({
      from: 'old-model',
      to: 'new-model',
    })
    vi.runAllTimers()
  })
})

describe('legacy normal chat migration', () => {
  it('uploads structured history and clears the browser transcript', async () => {
    const { migrateLegacyNormalChats } =
      await import('@/features/playground/hooks/use-session-cloud-sync')
    const createConversation = vi.fn().mockResolvedValue({ id: 104 })
    const putConversationMessages = vi.fn().mockResolvedValue(undefined)
    const patchSession = vi.fn()

    await migrateLegacyNormalChats(
      [
        {
          id: 'legacy-chat',
          modality: 'chat',
          title: 'Legacy transcript',
          model: 'old-model',
          group: 'default',
          kind: 'chat',
          messages: [
            {
              key: 'legacy-user',
              from: 'user',
              versions: [{ id: '1', content: 'read this' }],
              attachments: [
                {
                  id: 'asset-12',
                  kind: 'document',
                  name: 'notes.pdf',
                  mimeType: 'application/pdf',
                  text: '',
                  assetId: 12,
                },
              ],
              status: 'complete',
            },
            {
              key: 'legacy-assistant',
              from: 'assistant',
              versions: [{ id: '1', content: 'done' }],
              sources: [{ title: 'Source', href: 'https://example.com' }],
              status: 'complete',
            },
          ],
          isDraft: false,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      {
        getConversation: vi.fn(),
        createConversation,
        deleteConversation: vi.fn(),
        putConversationMessages,
        appendConversationMessages: vi.fn(),
        patchSession,
        getSession: vi.fn(),
      }
    )

    expect(createConversation).toHaveBeenCalledWith({
      title: 'Legacy transcript',
      model: 'old-model',
      group: 'default',
      kind: 'chat',
      source: 'web',
    })
    expect(putConversationMessages).toHaveBeenCalledWith(104, [
      expect.objectContaining({
        role: 'user',
        content: 'read this',
        content_json: [
          {
            type: 'file',
            mediaType: 'application/pdf',
            filename: 'notes.pdf',
            url: '/api/playground/assets/12/content',
          },
          { type: 'text', text: 'read this' },
        ],
      }),
      expect.objectContaining({
        role: 'assistant',
        content: 'done',
        content_json: undefined,
        tool_json: {
          sources: [{ title: 'Source', href: 'https://example.com' }],
        },
      }),
    ])
    expect(patchSession).toHaveBeenLastCalledWith('legacy-chat', {
      serverId: 104,
      messages: [],
      isDraft: false,
    })
  })

  it('never overwrites an agent-managed server transcript', async () => {
    const { migrateLegacyNormalChats } =
      await import('@/features/playground/hooks/use-session-cloud-sync')
    const putConversationMessages = vi.fn()
    const patchSession = vi.fn()

    await migrateLegacyNormalChats(
      [
        {
          id: 'bound-chat',
          serverId: 105,
          modality: 'chat',
          title: 'Bound transcript',
          model: 'model',
          group: 'default',
          kind: 'chat',
          messages: [
            {
              key: 'stale',
              from: 'user',
              versions: [{ id: '1', content: 'stale local copy' }],
              status: 'complete',
            },
          ],
          isDraft: false,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      {
        getConversation: vi.fn().mockResolvedValue({
          conversation: { id: 105, revision: 3 },
          messages: [],
        }),
        createConversation: vi.fn(),
        deleteConversation: vi.fn(),
        putConversationMessages,
        appendConversationMessages: vi.fn(),
        patchSession,
        getSession: vi.fn(),
      }
    )

    expect(putConversationMessages).not.toHaveBeenCalled()
    expect(patchSession).toHaveBeenCalledWith('bound-chat', {
      messages: [],
      isDraft: false,
    })
  })

  it('appends only missing local turns without replacing cloud history', async () => {
    const { migrateLegacyNormalChats } =
      await import('@/features/playground/hooks/use-session-cloud-sync')
    const appendConversationMessages = vi.fn().mockResolvedValue({
      messages: [],
      appended: 1,
      skipped: 0,
    })
    const putConversationMessages = vi.fn()
    const patchSession = vi.fn()

    await migrateLegacyNormalChats(
      [
        {
          id: 'partially-synced-chat',
          serverId: 106,
          modality: 'chat',
          title: 'Partially synced',
          model: 'model',
          group: 'default',
          kind: 'chat',
          messages: [
            {
              key: 'already-cloud',
              from: 'user',
              versions: [{ id: '1', content: 'already saved' }],
              status: 'complete',
            },
            {
              key: 'local-only',
              from: 'assistant',
              versions: [{ id: '1', content: 'missing remotely' }],
              status: 'complete',
            },
          ],
          isDraft: false,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      {
        getConversation: vi.fn().mockResolvedValue({
          conversation: { id: 106, revision: 0 },
          messages: [
            {
              id: 1,
              role: 'system',
              content: 'remote-only context',
              client_key: 'remote-only',
              seq: 0,
            },
            {
              id: 2,
              role: 'user',
              content: 'already saved',
              client_key: 'already-cloud',
              seq: 1,
            },
          ],
        }),
        createConversation: vi.fn(),
        deleteConversation: vi.fn(),
        putConversationMessages,
        appendConversationMessages,
        patchSession,
        getSession: vi.fn(),
      }
    )

    expect(putConversationMessages).not.toHaveBeenCalled()
    expect(appendConversationMessages).toHaveBeenCalledWith(
      106,
      [
        expect.objectContaining({
          client_key: 'local-only',
          content: 'missing remotely',
        }),
      ],
      { longMemory: false }
    )
    expect(patchSession).toHaveBeenCalledWith('partially-synced-chat', {
      serverId: 106,
      messages: [],
      isDraft: false,
    })
  })

  it('removes an empty server shell when initial transcript upload fails', async () => {
    const { migrateLegacyNormalChats } =
      await import('@/features/playground/hooks/use-session-cloud-sync')
    const deleteConversation = vi.fn().mockResolvedValue(undefined)
    const patchSession = vi.fn()

    await migrateLegacyNormalChats(
      [
        {
          id: 'failed-import',
          modality: 'chat',
          title: 'Failed import',
          model: 'model',
          group: 'default',
          kind: 'chat',
          messages: [
            {
              key: 'local-message',
              from: 'user',
              versions: [{ id: '1', content: 'keep me locally' }],
              status: 'complete',
            },
          ],
          isDraft: false,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      {
        getConversation: vi.fn(),
        createConversation: vi.fn().mockResolvedValue({ id: 107 }),
        deleteConversation,
        putConversationMessages: vi.fn().mockRejectedValue(new Error('failed')),
        appendConversationMessages: vi.fn(),
        patchSession,
        getSession: vi.fn(),
      }
    )

    expect(deleteConversation).toHaveBeenCalledWith(107)
    expect(patchSession).not.toHaveBeenCalled()
  })
})
