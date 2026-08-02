import { describe, expect, test } from 'bun:test'

import { agentToolChoice } from '../engine/run-agent'
import { buildTools } from './index'

const context = {
  userId: 7,
  group: 'default',
  modelId: 'test-model',
}

describe('agent tool policy', () => {
  test('exposes every tool in auto mode', () => {
    const policy = buildTools(context, 'auto')
    expect(Object.keys(policy.tools).sort()).toEqual([
      'generate_document',
      'generate_image',
      'generate_video',
      'web_search',
    ])
    expect(policy.forceTool).toBeUndefined()
  })

  test.each([
    ['image', 'generate_image'],
    ['video', 'generate_video'],
    ['search', 'web_search'],
    ['document', 'generate_document'],
  ] as const)('forces %s mode through its matching tool', (mode, toolName) => {
    const policy = buildTools(context, mode)
    expect(Object.keys(policy.tools)).toEqual([toolName])
    expect(policy.forceTool).toBe(toolName)
    expect(agentToolChoice(policy.forceTool, 0)).toEqual({
      type: 'tool',
      toolName,
    })
    expect(agentToolChoice(policy.forceTool, 1)).toBe('auto')
  })
})
