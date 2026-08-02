import { describe, expect, it } from 'vitest'

import type { ChatDocumentAttachment, ChatImageAttachment } from '../../types'
import { applyMessageEdit } from './conversation-message-utils'
import { getMessageEditorState } from './message-editor-utils'
import { buildMessageContent, createUserMessage } from './message-utils'

function imageAttachment(
  overrides: Partial<ChatImageAttachment> = {}
): ChatImageAttachment {
  return {
    id: 'i1',
    kind: 'image',
    name: 'shot.png',
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,AAA',
    ...overrides,
  }
}

function documentAttachment(
  overrides: Partial<ChatDocumentAttachment> = {}
): ChatDocumentAttachment {
  return {
    id: 'd1',
    kind: 'document',
    name: 'report.docx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    text: 'Quarterly numbers\nRevenue up',
    ...overrides,
  }
}

describe('createUserMessage', () => {
  it('keeps parsed documents, which carry no binary payload', () => {
    const message = createUserMessage('summarize', 1, [documentAttachment()])
    expect(message.attachments).toEqual([documentAttachment()])
  })

  it('drops attachments with no usable payload at all', () => {
    const message = createUserMessage('hi', 1, [
      documentAttachment({ text: '  ' }),
      imageAttachment({ dataUrl: '' }),
    ])
    expect(message.attachments).toBeUndefined()
  })
})

describe('buildMessageContent', () => {
  it('returns plain text when no usable attachments exist', () => {
    expect(buildMessageContent('hi', [])).toBe('hi')
    expect(buildMessageContent('hi', [documentAttachment({ text: '' })])).toBe(
      'hi'
    )
  })

  it('emits images as image_url parts', () => {
    const parts = buildMessageContent('look', [imageAttachment()])
    expect(parts).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ])
  })

  it('emits parsed document text as a labeled text part', () => {
    const parts = buildMessageContent('summarize', [
      documentAttachment({ name: 'doc.pdf', text: 'page one' }),
    ])
    expect(parts).toEqual([
      { type: 'text', text: 'summarize' },
      { type: 'text', text: 'Attached document "doc.pdf":\n\npage one' },
    ])
  })

  it('drops an unreadable document instead of sending an empty part', () => {
    const parts = buildMessageContent('summarize', [
      documentAttachment({ text: '' }),
      imageAttachment(),
    ])
    expect(parts).toEqual([
      { type: 'text', text: 'summarize' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ])
  })
})

describe('message attachment editing', () => {
  it('replaces the attachment set atomically with the text edit', () => {
    const original = createUserMessage('summarize', 1, [
      documentAttachment({ id: 'old', assetId: 7 }),
    ])
    const replacement = documentAttachment({ id: 'new', assetId: 8 })
    const result = applyMessageEdit(
      [original],
      original.key,
      'summarize the replacement',
      false,
      [replacement]
    )
    expect(result?.messages[0]?.attachments).toEqual([replacement])
    expect(result?.messages[0]?.versions[0]?.content).toBe(
      'summarize the replacement'
    )
  })

  it('allows an attachment-only edit but blocks an empty message', () => {
    const message = createUserMessage('', 1, [
      documentAttachment({ assetId: 7 }),
    ])
    expect(
      getMessageEditorState(message, '', '', {
        hasAttachments: true,
        attachmentsChanged: true,
      }).canSave
    ).toBe(true)
    expect(
      getMessageEditorState(message, '', '', {
        hasAttachments: false,
        attachmentsChanged: true,
      }).canSave
    ).toBe(false)
  })
})
