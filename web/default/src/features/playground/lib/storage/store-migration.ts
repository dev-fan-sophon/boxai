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
import { STORAGE_KEYS } from '../../constants'
import type {
  Message,
  ParameterEnabled,
  PlaygroundConfig,
  StudioSettings,
} from '../../types'
import {
  getInitialParameterEnabled,
  getInitialPlaygroundConfig,
} from '../state/playground-state-utils'
import {
  MAX_MY_WORKS,
  MAX_PINNED_MODELS,
  MAX_RECENT_PROMPTS,
  loadWorkbenchPrefs,
  normalizeChatTools,
  type InspirationWork,
  type RecentPrompt,
  type WorkbenchChatTools,
} from '../workbench/workbench-prefs'
import { loadMessages, prepareLoadedMessages } from './storage'
import {
  MAX_STORED_MESSAGES,
  messagesSchema,
  playgroundConfigSchema,
} from './storage-schema'

export const PLAYGROUND_STORE_STORAGE_KEY = STORAGE_KEYS.STORE
export const PLAYGROUND_STORE_VERSION = 2

export type PlaygroundWorkspaceMode = 'model' | 'duo'

export type PlaygroundDuoConfig = {
  answerModels: string[]
  summaryModel: string
}

export type PlaygroundUiPrefs = {
  settingsPanelOpen: boolean
}

/**
 * Client-side playground state persisted under the single versioned
 * `playground_store_v2` key. Server data (models, pricing, tasks) is never
 * part of this shape — it lives in react-query.
 */
export type PersistedPlaygroundState = {
  workspaceMode: PlaygroundWorkspaceMode
  config: PlaygroundConfig
  parameterEnabled: ParameterEnabled
  chatTools: WorkbenchChatTools
  studioSettings: StudioSettings
  duo: PlaygroundDuoConfig
  pinnedModels: string[]
  recentPrompts: RecentPrompt[]
  myWorks: InspirationWork[]
  messages: Message[]
  ui: PlaygroundUiPrefs
}

/** Remove ephemeral attachment data before Zustand serializes playground state. */
export function preparePersistedPlaygroundState(
  state: PersistedPlaygroundState
): PersistedPlaygroundState {
  const messages =
    state.messages.length > MAX_STORED_MESSAGES
      ? state.messages.slice(-MAX_STORED_MESSAGES)
      : state.messages

  return {
    workspaceMode: state.workspaceMode,
    config: state.config,
    parameterEnabled: state.parameterEnabled,
    chatTools: state.chatTools,
    studioSettings: state.studioSettings,
    duo: state.duo,
    pinnedModels: state.pinnedModels,
    recentPrompts: state.recentPrompts,
    myWorks: state.myWorks,
    messages: messages.map((message) => ({
      ...message,
      attachments: undefined,
      managedTool: message.managedTool
        ? {
            ...message.managedTool,
            images: message.managedTool.images?.filter(
              (url) => !url.startsWith('data:')
            ),
            videoUrl: message.managedTool.videoUrl?.startsWith('data:')
              ? undefined
              : message.managedTool.videoUrl,
          }
        : undefined,
    })),
    ui: state.ui,
  }
}

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  imageCount: 1,
  imageSize: '1024x1024',
  imageQuality: 'standard',
  videoDuration: 5,
  videoSize: '1280x720',
  voice: 'alloy',
  speed: 1,
  audioFormat: 'mp3',
}

export const MAX_DUO_ANSWER_MODELS = 5

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .slice(0, limit)
}

export function normalizeStudioSettings(value: unknown): StudioSettings {
  const raw = isRecord(value) ? value : {}
  const merged = { ...DEFAULT_STUDIO_SETTINGS, ...raw }
  return {
    imageCount: clampNumber(
      merged.imageCount,
      1,
      10,
      DEFAULT_STUDIO_SETTINGS.imageCount
    ),
    imageSize:
      typeof merged.imageSize === 'string'
        ? merged.imageSize
        : DEFAULT_STUDIO_SETTINGS.imageSize,
    imageQuality:
      typeof merged.imageQuality === 'string'
        ? merged.imageQuality
        : DEFAULT_STUDIO_SETTINGS.imageQuality,
    videoDuration: clampNumber(
      merged.videoDuration,
      1,
      60,
      DEFAULT_STUDIO_SETTINGS.videoDuration
    ),
    videoSize:
      typeof merged.videoSize === 'string'
        ? merged.videoSize
        : DEFAULT_STUDIO_SETTINGS.videoSize,
    voice:
      typeof merged.voice === 'string'
        ? merged.voice
        : DEFAULT_STUDIO_SETTINGS.voice,
    speed: clampNumber(merged.speed, 0.25, 4, DEFAULT_STUDIO_SETTINGS.speed),
    audioFormat:
      typeof merged.audioFormat === 'string'
        ? merged.audioFormat
        : DEFAULT_STUDIO_SETTINGS.audioFormat,
  }
}

export function normalizeDuoConfig(value: unknown): PlaygroundDuoConfig {
  const raw = isRecord(value) ? value : {}
  return {
    answerModels: stringArray(raw.answerModels, MAX_DUO_ANSWER_MODELS),
    summaryModel: typeof raw.summaryModel === 'string' ? raw.summaryModel : '',
  }
}

function isRecentPrompt(value: unknown): value is RecentPrompt {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.prompt === 'string' &&
    typeof value.modality === 'string' &&
    typeof value.model === 'string' &&
    typeof value.createdAt === 'number'
  )
}

function isInspirationWork(value: unknown): value is InspirationWork {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.modality === 'string' &&
    typeof value.prompt === 'string' &&
    typeof value.createdAt === 'number'
  )
}

function readLegacyStudioSettings(): StudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STUDIO)
    if (!raw) return { ...DEFAULT_STUDIO_SETTINGS }
    const parsed = JSON.parse(raw) as { settings?: unknown }
    return normalizeStudioSettings(parsed.settings)
  } catch {
    return { ...DEFAULT_STUDIO_SETTINGS }
  }
}

function readLegacyMessages(): Message[] {
  try {
    return loadMessages() ?? []
  } catch {
    return []
  }
}

/**
 * Assemble store state from the five legacy localStorage keys
 * (playground_config / playground_messages / playground_parameter_enabled /
 * playground_studio / playground_workbench_prefs_v1). Each key is read
 * independently so one corrupted key never discards the others. The legacy
 * keys are never deleted by this module — playground_messages in particular
 * stays on disk as the safety net for this release.
 */
export function readLegacyPlaygroundState(): PersistedPlaygroundState {
  const prefs = loadWorkbenchPrefs()
  return {
    workspaceMode: 'model',
    config: getInitialPlaygroundConfig(),
    parameterEnabled: getInitialParameterEnabled(),
    chatTools: prefs.chatTools,
    studioSettings: readLegacyStudioSettings(),
    duo: normalizeDuoConfig(prefs.duo),
    pinnedModels: prefs.pinnedModels,
    recentPrompts: prefs.recentPrompts,
    myWorks: prefs.myWorks,
    messages: readLegacyMessages(),
    ui: { settingsPanelOpen: true },
  }
}

function normalizeConfigField(value: unknown): PlaygroundConfig {
  try {
    const parsed = playgroundConfigSchema.parse(value)
    return { ...getInitialPlaygroundConfig(), ...parsed }
  } catch {
    return getInitialPlaygroundConfig()
  }
}

function normalizeParameterEnabledField(value: unknown): ParameterEnabled {
  const fallback = getInitialParameterEnabled()
  if (!isRecord(value)) return fallback
  const result = { ...fallback }
  for (const key of Object.keys(result) as (keyof ParameterEnabled)[]) {
    const enabled = value[key]
    if (typeof enabled === 'boolean') result[key] = enabled
  }
  return result
}

function normalizeMessagesField(value: unknown): Message[] {
  try {
    const parsed = messagesSchema.parse(value) as Message[]
    return prepareLoadedMessages(parsed)
  } catch {
    return readLegacyMessages()
  }
}

function extractPersistedEnvelopeState(value: unknown): unknown {
  if (!isRecord(value)) return null
  if ('state' in value) return value.state
  return value
}

/**
 * Read the persisted playground store state. Prefers the versioned
 * `playground_store_v2` key; any unreadable field (or the whole key) falls
 * back to the legacy per-feature keys, never to silent data loss.
 */
export function loadPersistedPlaygroundState(): PersistedPlaygroundState {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(PLAYGROUND_STORE_STORAGE_KEY)
  } catch {
    raw = null
  }
  if (!raw) return readLegacyPlaygroundState()

  let envelope: unknown
  try {
    envelope = JSON.parse(raw)
  } catch {
    return readLegacyPlaygroundState()
  }

  const state = extractPersistedEnvelopeState(envelope)
  if (!isRecord(state)) return readLegacyPlaygroundState()

  return {
    workspaceMode: state.workspaceMode === 'duo' ? 'duo' : 'model',
    config: normalizeConfigField(state.config),
    parameterEnabled: normalizeParameterEnabledField(state.parameterEnabled),
    chatTools: normalizeChatTools(
      isRecord(state.chatTools)
        ? (state.chatTools as Partial<WorkbenchChatTools>)
        : null
    ),
    studioSettings: normalizeStudioSettings(state.studioSettings),
    duo: normalizeDuoConfig(state.duo),
    pinnedModels: stringArray(state.pinnedModels, MAX_PINNED_MODELS),
    recentPrompts: Array.isArray(state.recentPrompts)
      ? state.recentPrompts.filter(isRecentPrompt).slice(0, MAX_RECENT_PROMPTS)
      : [],
    myWorks: Array.isArray(state.myWorks)
      ? state.myWorks.filter(isInspirationWork).slice(0, MAX_MY_WORKS)
      : [],
    messages: normalizeMessagesField(state.messages),
    ui: {
      settingsPanelOpen: isRecord(state.ui)
        ? state.ui.settingsPanelOpen !== false
        : true,
    },
  }
}
