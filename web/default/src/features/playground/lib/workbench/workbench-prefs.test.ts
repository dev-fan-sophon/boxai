import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_CHAT_TOOLS,
  DEFAULT_WORKBENCH_PREFS,
  LEGACY_BUILTIN_ASSISTANT_SYSTEM_PROMPT,
  loadWorkbenchPrefs,
  normalizeChatTools,
} from './workbench-prefs'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DEFAULT_CHAT_TOOLS', () => {
  it('ships without a custom persona (platform base prompt is always applied)', () => {
    expect(DEFAULT_CHAT_TOOLS.systemPrompt).toBe('')
  })
})

describe('normalizeChatTools', () => {
  it('keeps blank persona prompts empty', () => {
    expect(normalizeChatTools({ systemPrompt: '' }).systemPrompt).toBe('')
    expect(normalizeChatTools({ systemPrompt: '  \n' }).systemPrompt).toBe('')
    expect(normalizeChatTools(null).systemPrompt).toBe('')
  })

  it('migrates the retired built-in persona back to empty', () => {
    expect(
      normalizeChatTools({
        systemPrompt: LEGACY_BUILTIN_ASSISTANT_SYSTEM_PROMPT,
      }).systemPrompt
    ).toBe('')
  })

  it('keeps a custom persona when provided', () => {
    expect(
      normalizeChatTools({ systemPrompt: '  You are a pirate.  ' }).systemPrompt
    ).toBe('You are a pirate.')
  })
})

describe('loadWorkbenchPrefs', () => {
  it('returns detached defaults without structuredClone support', () => {
    vi.stubGlobal('localStorage', { getItem: () => null })
    vi.stubGlobal('structuredClone', undefined)

    const prefs = loadWorkbenchPrefs()

    prefs.pinnedModels.push('model-a')
    prefs.duo.answerModels.push('model-b')

    expect(DEFAULT_WORKBENCH_PREFS.pinnedModels).toEqual([])
    expect(DEFAULT_WORKBENCH_PREFS.duo.answerModels).toEqual([])
  })
})
