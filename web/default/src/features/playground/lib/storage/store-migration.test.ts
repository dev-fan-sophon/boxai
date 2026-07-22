/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONFIG, STORAGE_KEYS } from '../../constants'
import type { Message } from '../../types'
import {
  DEFAULT_STUDIO_SETTINGS,
  loadPersistedPlaygroundState,
  type PersistedPlaygroundState,
} from './store-migration'

function createLocalStorageStub() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  }
}

const userMessage: Message = {
  key: 'm1',
  from: 'user',
  versions: [{ id: 'v1', content: 'hello from legacy storage' }],
  status: 'complete',
}

function seedLegacyKeys() {
  localStorage.setItem(
    STORAGE_KEYS.CONFIG,
    JSON.stringify({
      version: 1,
      data: { model: 'claude-x', temperature: 0.3 },
    })
  )
  localStorage.setItem(
    STORAGE_KEYS.MESSAGES,
    JSON.stringify({ version: 1, data: [userMessage] })
  )
  localStorage.setItem(
    STORAGE_KEYS.PARAMETER_ENABLED,
    JSON.stringify({ version: 1, data: { seed: true } })
  )
  localStorage.setItem(
    STORAGE_KEYS.STUDIO,
    JSON.stringify({ settings: { imageCount: 99, voice: 'nova' } })
  )
  localStorage.setItem(
    STORAGE_KEYS.WORKBENCH,
    JSON.stringify({
      pinnedModels: ['gpt-4o', 42],
      chatTools: { webSearch: true, maxToolLoops: 50 },
      duo: { enabled: true, answerModels: ['a', 'b'], summaryModel: 's' },
      recentPrompts: [
        {
          id: 'r1',
          prompt: 'draw a cat',
          modality: 'image',
          model: 'gpt-image-1',
          createdAt: 1,
        },
      ],
      myWorks: [],
    })
  )
}

function seedV2(state: Partial<PersistedPlaygroundState> | unknown) {
  localStorage.setItem(
    STORAGE_KEYS.STORE,
    JSON.stringify({ state, version: 2 })
  )
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createLocalStorageStub())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadPersistedPlaygroundState', () => {
  it('returns defaults when no storage keys exist', () => {
    const state = loadPersistedPlaygroundState()
    expect(state.config).toEqual(DEFAULT_CONFIG)
    expect(state.messages).toEqual([])
    expect(state.workspaceMode).toBe('model')
    expect(state.studioSettings).toEqual(DEFAULT_STUDIO_SETTINGS)
    expect(state.ui.settingsPanelOpen).toBe(true)
  })

  it('migrates the five legacy keys when the v2 key is missing', () => {
    seedLegacyKeys()
    const state = loadPersistedPlaygroundState()

    expect(state.config.model).toBe('claude-x')
    expect(state.config.temperature).toBe(0.3)
    expect(state.config.stream).toBe(DEFAULT_CONFIG.stream)
    expect(state.parameterEnabled.seed).toBe(true)
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].versions[0].content).toBe(
      'hello from legacy storage'
    )
    // Studio values clamped on load, invalid pin entries dropped.
    expect(state.studioSettings.imageCount).toBe(10)
    expect(state.studioSettings.voice).toBe('nova')
    expect(state.pinnedModels).toEqual(['gpt-4o'])
    expect(state.chatTools.webSearch).toBe(true)
    expect(state.chatTools.maxToolLoops).toBe(20)
    // Legacy duo.enabled is dropped; duo config itself carries over.
    expect(state.workspaceMode).toBe('model')
    expect(state.duo).toEqual({ answerModels: ['a', 'b'], summaryModel: 's' })
    expect(state.recentPrompts).toHaveLength(1)
  })

  it('never deletes the legacy keys during migration', () => {
    seedLegacyKeys()
    loadPersistedPlaygroundState()
    expect(localStorage.getItem(STORAGE_KEYS.MESSAGES)).not.toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.CONFIG)).not.toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.WORKBENCH)).not.toBeNull()
  })

  it('prefers a valid v2 key over legacy keys', () => {
    seedLegacyKeys()
    const v2Message: Message = {
      key: 'm2',
      from: 'assistant',
      versions: [{ id: 'v1', content: 'answer from v2' }],
      status: 'complete',
    }
    seedV2({
      workspaceMode: 'duo',
      config: { model: 'gemini-pro' },
      messages: [v2Message],
      pinnedModels: ['gemini-pro'],
      ui: { settingsPanelOpen: false },
    })

    const state = loadPersistedPlaygroundState()
    expect(state.config.model).toBe('gemini-pro')
    expect(state.workspaceMode).toBe('duo')
    expect(state.messages[0].versions[0].content).toBe('answer from v2')
    expect(state.pinnedModels).toEqual(['gemini-pro'])
    expect(state.ui.settingsPanelOpen).toBe(false)
  })

  it('falls back to legacy keys when the v2 key is corrupted JSON', () => {
    seedLegacyKeys()
    localStorage.setItem(STORAGE_KEYS.STORE, '{not valid json')

    const state = loadPersistedPlaygroundState()
    expect(state.config.model).toBe('claude-x')
    expect(state.messages[0].versions[0].content).toBe(
      'hello from legacy storage'
    )
  })

  it('falls back to legacy messages when only the v2 messages field is invalid', () => {
    seedLegacyKeys()
    seedV2({
      config: { model: 'gemini-pro' },
      messages: [{ key: 'broken', versions: 'not-an-array' }],
    })

    const state = loadPersistedPlaygroundState()
    // Valid v2 fields win; the unreadable messages field recovers from legacy.
    expect(state.config.model).toBe('gemini-pro')
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].versions[0].content).toBe(
      'hello from legacy storage'
    )
  })
})
