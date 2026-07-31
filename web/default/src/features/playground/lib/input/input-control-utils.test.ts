import { describe, expect, it } from 'vitest'

import { getInputControlState } from './input-control-utils'

const availableModel = [{ value: 'gpt-test', label: 'GPT Test' }]

describe('getInputControlState', () => {
  it('allows an attachment-only message', () => {
    const state = getInputControlState({
      groups: [],
      hasAttachments: true,
      hasStopHandler: false,
      models: availableModel,
      text: '',
    })

    expect(state.canSubmit).toBe(true)
  })

  it('blocks submission while attachments are being read', () => {
    const state = getInputControlState({
      groups: [],
      hasAttachments: true,
      hasStopHandler: false,
      isAddingAttachments: true,
      models: availableModel,
      text: 'send now',
    })

    expect(state.canSubmit).toBe(false)
  })
})
