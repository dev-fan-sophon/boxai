/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
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
