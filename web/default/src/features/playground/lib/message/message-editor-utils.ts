import { MESSAGE_ROLES } from '../../constants'
import type { Message } from '../../types'

type MessageEditorState = {
  canSave: boolean
  hasChanged: boolean
  showSaveAndSubmit: boolean
}

export function getMessageEditorState(
  message: Message,
  editText: string,
  originalText: string,
  options: {
    hasAttachments?: boolean
    attachmentsChanged?: boolean
    blocked?: boolean
  } = {}
): MessageEditorState {
  const hasPayload =
    editText.trim().length > 0 || options.hasAttachments === true
  const hasChanged =
    editText !== originalText || options.attachmentsChanged === true

  return {
    canSave: hasPayload && hasChanged && options.blocked !== true,
    hasChanged,
    showSaveAndSubmit: message.from === MESSAGE_ROLES.USER,
  }
}
