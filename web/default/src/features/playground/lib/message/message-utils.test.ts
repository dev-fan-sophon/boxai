/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { describe, expect, it } from 'vitest'

import type { ChatAttachment } from '../../types'
import { buildMessageContent } from './message-utils'

function attachment(overrides: Partial<ChatAttachment>): ChatAttachment {
  return {
    id: 'a1',
    name: 'file',
    mimeType: 'application/octet-stream',
    dataUrl: '',
    type: 'file',
    ...overrides,
  }
}

describe('buildMessageContent', () => {
  it('returns plain text when no usable attachments exist', () => {
    expect(buildMessageContent('hi', [])).toBe('hi')
    expect(buildMessageContent('hi', [attachment({ type: 'document' })])).toBe(
      'hi'
    )
  })

  it('emits image and file parts from data URLs', () => {
    const parts = buildMessageContent('look', [
      attachment({
        type: 'image',
        dataUrl: 'data:image/png;base64,AAA',
      }),
      attachment({
        type: 'file',
        name: 'doc.pdf',
        dataUrl: 'data:application/pdf;base64,BBB',
      }),
    ])
    expect(parts).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      {
        type: 'file',
        file: {
          filename: 'doc.pdf',
          file_data: 'data:application/pdf;base64,BBB',
        },
      },
    ])
  })

  it('emits extracted document text as a labeled text part', () => {
    const parts = buildMessageContent('summarize', [
      attachment({
        type: 'document',
        name: 'report.docx',
        textContent: 'Quarterly numbers\nRevenue up',
      }),
    ])
    expect(parts).toEqual([
      { type: 'text', text: 'summarize' },
      {
        type: 'text',
        text: 'Attached document "report.docx":\n\nQuarterly numbers\nRevenue up',
      },
    ])
  })
})
