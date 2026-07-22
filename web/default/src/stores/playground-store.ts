/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { create } from 'zustand'
import {
  persist,
  type PersistStorage,
  type StorageValue,
} from 'zustand/middleware'

import {
  DEFAULT_CONFIG,
  DEFAULT_PARAMETER_ENABLED,
} from '@/features/playground/constants'
import {
  applyMessageStateUpdate,
  type MessageStateUpdater,
} from '@/features/playground/lib/state/playground-state-utils'
import { MAX_STORED_MESSAGES } from '@/features/playground/lib/storage/storage-schema'
import {
  DEFAULT_STUDIO_SETTINGS,
  MAX_DUO_ANSWER_MODELS,
  PLAYGROUND_STORE_STORAGE_KEY,
  PLAYGROUND_STORE_VERSION,
  loadPersistedPlaygroundState,
  normalizeStudioSettings,
  type PersistedPlaygroundState,
  type PlaygroundWorkspaceMode,
} from '@/features/playground/lib/storage/store-migration'
import {
  DEFAULT_CHAT_TOOLS,
  MAX_MY_WORKS,
  MAX_PINNED_MODELS,
  MAX_RECENT_PROMPTS,
  normalizeChatTools,
  type InspirationWork,
  type RecentPrompt,
  type WorkbenchChatTools,
} from '@/features/playground/lib/workbench/workbench-prefs'
import type {
  GroupOption,
  ModelOption,
  ParameterEnabled,
  PlaygroundConfig,
  StudioModality,
  StudioSettings,
} from '@/features/playground/types'

const PERSIST_WRITE_DEBOUNCE_MS = 500

export type PlaygroundView = 'workspace' | 'agents' | 'inspiration'

export type PlaygroundPrefill = {
  prompt: string
  nonce: number
}

export type PlaygroundGenerationStatus = {
  activeModality: StudioModality | null
  pendingCount: number
}

interface PlaygroundStoreState extends PersistedPlaygroundState {
  // Ephemeral (not persisted)
  view: PlaygroundView
  models: ModelOption[]
  groups: GroupOption[]
  prefill: PlaygroundPrefill | null
  generation: PlaygroundGenerationStatus

  setView: (view: PlaygroundView) => void
  setWorkspaceMode: (mode: PlaygroundWorkspaceMode) => void
  selectModel: (model: string, group?: string) => void
  selectDuo: () => void
  updateConfig: (patch: Partial<PlaygroundConfig>) => void
  resetConfig: () => void
  setParameterEnabled: (patch: Partial<ParameterEnabled>) => void
  setChatTools: (patch: Partial<WorkbenchChatTools>) => void
  setStudioSettings: (
    value: StudioSettings | ((prev: StudioSettings) => StudioSettings)
  ) => void
  setDuoConfig: (patch: {
    answerModels?: string[]
    summaryModel?: string
  }) => void
  togglePinnedModel: (modelName: string) => void
  addRecentPrompt: (input: {
    prompt: string
    modality: StudioModality
    model: string
  }) => void
  addMyWork: (work: Omit<InspirationWork, 'id' | 'createdAt'>) => void
  removeMyWork: (id: string) => void
  setMessages: (updater: MessageStateUpdater) => void
  clearMessages: () => void
  setModels: (models: ModelOption[]) => void
  setGroups: (groups: GroupOption[]) => void
  setPrefill: (prompt: string) => void
  consumePrefill: () => void
  setSettingsPanelOpen: (open: boolean) => void
  beginGeneration: (modality: StudioModality) => void
  endGeneration: () => void
  resetWorkbenchPrefs: () => void
}

function generateEntryId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Debounced, validated persistence: reads go through the migration reader
// (v2 key with fallback to the five legacy keys), writes are trailing
// debounced so streaming updates do not hammer localStorage. Pending writes
// are flushed on pagehide/beforeunload.
let pendingWrite: {
  name: string
  value: StorageValue<PersistedPlaygroundState>
} | null = null
let writeTimer: number | null = null

function flushPendingWrite(): void {
  if (writeTimer !== null) {
    window.clearTimeout(writeTimer)
    writeTimer = null
  }
  if (!pendingWrite) return
  const { name, value } = pendingWrite
  pendingWrite = null
  try {
    localStorage.setItem(name, JSON.stringify(value))
  } catch {
    // Storage may be unavailable or full (private browsing, quota).
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPendingWrite)
  window.addEventListener('beforeunload', flushPendingWrite)
}

const playgroundPersistStorage: PersistStorage<PersistedPlaygroundState> = {
  getItem: () => ({
    state: loadPersistedPlaygroundState(),
    version: PLAYGROUND_STORE_VERSION,
  }),
  setItem: (name, value) => {
    pendingWrite = { name, value }
    if (writeTimer !== null) return
    writeTimer = window.setTimeout(() => {
      writeTimer = null
      flushPendingWrite()
    }, PERSIST_WRITE_DEBOUNCE_MS)
  },
  removeItem: (name) => {
    pendingWrite = null
    if (writeTimer !== null) {
      window.clearTimeout(writeTimer)
      writeTimer = null
    }
    try {
      localStorage.removeItem(name)
    } catch {
      // Storage may be unavailable.
    }
  },
}

export const usePlaygroundStore = create<PlaygroundStoreState>()(
  persist(
    (set) => ({
      // Persisted state; real values arrive synchronously via rehydration.
      workspaceMode: 'model',
      config: { ...DEFAULT_CONFIG },
      parameterEnabled: { ...DEFAULT_PARAMETER_ENABLED },
      chatTools: { ...DEFAULT_CHAT_TOOLS },
      studioSettings: { ...DEFAULT_STUDIO_SETTINGS },
      duo: { answerModels: [], summaryModel: '' },
      pinnedModels: [],
      recentPrompts: [],
      myWorks: [],
      messages: [],
      ui: { settingsPanelOpen: true },

      view: 'workspace',
      models: [],
      groups: [],
      prefill: null,
      generation: { activeModality: null, pendingCount: 0 },

      setView: (view) => set({ view }),
      setWorkspaceMode: (workspaceMode) => set({ workspaceMode }),
      selectModel: (model, group) =>
        set((state) => ({
          config: {
            ...state.config,
            model,
            ...(group !== undefined ? { group } : {}),
          },
          workspaceMode: 'model',
          view: 'workspace',
        })),
      selectDuo: () => set({ workspaceMode: 'duo', view: 'workspace' }),
      updateConfig: (patch) =>
        set((state) => ({ config: { ...state.config, ...patch } })),
      resetConfig: () =>
        set({
          config: { ...DEFAULT_CONFIG },
          parameterEnabled: { ...DEFAULT_PARAMETER_ENABLED },
        }),
      setParameterEnabled: (patch) =>
        set((state) => ({
          parameterEnabled: { ...state.parameterEnabled, ...patch },
        })),
      setChatTools: (patch) =>
        set((state) => ({
          chatTools: normalizeChatTools({ ...state.chatTools, ...patch }),
        })),
      setStudioSettings: (value) =>
        set((state) => ({
          studioSettings: normalizeStudioSettings(
            typeof value === 'function' ? value(state.studioSettings) : value
          ),
        })),
      setDuoConfig: (patch) =>
        set((state) => ({
          duo: {
            answerModels: (patch.answerModels ?? state.duo.answerModels).slice(
              0,
              MAX_DUO_ANSWER_MODELS
            ),
            summaryModel: patch.summaryModel ?? state.duo.summaryModel,
          },
        })),
      togglePinnedModel: (modelName) =>
        set((state) => {
          const exists = state.pinnedModels.includes(modelName)
          return {
            pinnedModels: exists
              ? state.pinnedModels.filter((name) => name !== modelName)
              : [modelName, ...state.pinnedModels].slice(0, MAX_PINNED_MODELS),
          }
        }),
      addRecentPrompt: (input) => {
        const prompt = input.prompt.trim()
        if (!prompt) return
        const entry: RecentPrompt = {
          id: generateEntryId(),
          prompt,
          modality: input.modality,
          model: input.model,
          createdAt: Date.now(),
        }
        set((state) => ({
          recentPrompts: [
            entry,
            ...state.recentPrompts.filter((item) => item.prompt !== prompt),
          ].slice(0, MAX_RECENT_PROMPTS),
        }))
      },
      addMyWork: (work) => {
        const entry: InspirationWork = {
          ...work,
          id: generateEntryId(),
          createdAt: Date.now(),
        }
        set((state) => ({
          myWorks: [entry, ...state.myWorks].slice(0, MAX_MY_WORKS),
        }))
      },
      removeMyWork: (id) =>
        set((state) => ({
          myWorks: state.myWorks.filter((item) => item.id !== id),
        })),
      setMessages: (updater) =>
        set((state) => ({
          messages: applyMessageStateUpdate(state.messages, updater),
        })),
      clearMessages: () => set({ messages: [] }),
      setModels: (models) => set({ models }),
      setGroups: (groups) => set({ groups }),
      setPrefill: (prompt) =>
        set((state) => ({
          prefill: { prompt, nonce: (state.prefill?.nonce ?? 0) + 1 },
        })),
      consumePrefill: () => set({ prefill: null }),
      setSettingsPanelOpen: (open) => set({ ui: { settingsPanelOpen: open } }),
      beginGeneration: (modality) =>
        set((state) => ({
          generation: {
            activeModality: modality,
            pendingCount: state.generation.pendingCount + 1,
          },
        })),
      endGeneration: () =>
        set((state) => {
          const pendingCount = Math.max(0, state.generation.pendingCount - 1)
          return {
            generation: {
              activeModality:
                pendingCount === 0 ? null : state.generation.activeModality,
              pendingCount,
            },
          }
        }),
      resetWorkbenchPrefs: () =>
        set({
          pinnedModels: [],
          chatTools: { ...DEFAULT_CHAT_TOOLS },
          duo: { answerModels: [], summaryModel: '' },
          recentPrompts: [],
          myWorks: [],
        }),
    }),
    {
      name: PLAYGROUND_STORE_STORAGE_KEY,
      version: PLAYGROUND_STORE_VERSION,
      storage: playgroundPersistStorage,
      partialize: (state): PersistedPlaygroundState => ({
        workspaceMode: state.workspaceMode,
        config: state.config,
        parameterEnabled: state.parameterEnabled,
        chatTools: state.chatTools,
        studioSettings: state.studioSettings,
        duo: state.duo,
        pinnedModels: state.pinnedModels,
        recentPrompts: state.recentPrompts,
        myWorks: state.myWorks,
        messages:
          state.messages.length > MAX_STORED_MESSAGES
            ? state.messages.slice(-MAX_STORED_MESSAGES)
            : state.messages,
        ui: state.ui,
      }),
    }
  )
)
