import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Message } from '@/features/playground/types'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('selectActiveChatMessages', () => {
  it('returns a stable store-owned snapshot even for legacy marker state', async () => {
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    })
    const { selectActiveChatMessages, usePlaygroundStore } =
      await import('./playground-store')
    const messages: Message[] = [
      {
        key: 'legacy-model-switch',
        from: 'system',
        versions: [{ id: 'v1', content: 'old → new' }],
        modelChangeFrom: 'old',
        modelChangeTo: 'new',
        status: 'complete',
      },
    ]
    const state = {
      ...usePlaygroundStore.getState(),
      sessions: [
        {
          id: 'chat-1',
          modality: 'chat' as const,
          title: 'Chat',
          model: 'new',
          group: 'default',
          messages,
          kind: 'chat' as const,
          isDraft: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeSessionByModality: { chat: 'chat-1' },
    }

    expect(selectActiveChatMessages(state)).toBe(messages)
    expect(selectActiveChatMessages(state)).toBe(
      selectActiveChatMessages(state)
    )
  })
})

describe('resetAccountData', () => {
  it('removes account-owned sessions and drafts without resetting preferences', async () => {
    vi.useFakeTimers()
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    })
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
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
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
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
