import { MESSAGE_ROLES } from '../../constants'
import type { ChatAttachment, Message } from '../../types'
import {
  addAssistantMessageVersion,
  createLoadingAssistantMessage,
  createUserMessage,
  getMessageContent,
  updateCurrentVersionContent,
} from './message-utils'

type ApplyMessageEditResult = {
  messages: Message[]
  shouldSend: boolean
}

type ChatMessageRenderState = {
  alwaysShowActions: boolean
  content: string
  isEditing: boolean
}

export function appendUserMessagePair(
  messages: Message[],
  content: string,
  attachments?: ChatAttachment[],
  model?: string
): Message[] {
  const submittedAt = Date.now()

  return [
    ...messages,
    createUserMessage(content, submittedAt, attachments),
    createLoadingAssistantMessage(submittedAt, model),
  ]
}

export function createRegeneratedMessages(
  messages: Message[],
  messageKey: string,
  model?: string
): Message[] | null {
  const messageIndex = messages.findIndex(
    (message) => message.key === messageKey
  )

  if (messageIndex === -1) {
    return null
  }

  const target = messages[messageIndex]

  if (target.from === MESSAGE_ROLES.USER) {
    const next = messages[messageIndex + 1]
    if (next && next.from === MESSAGE_ROLES.ASSISTANT) {
      return [
        ...messages.slice(0, messageIndex + 1),
        addAssistantMessageVersion(next, model),
      ]
    }
    return [
      ...messages.slice(0, messageIndex + 1),
      createLoadingAssistantMessage(Date.now(), model),
    ]
  }

  return [
    ...messages.slice(0, messageIndex),
    addAssistantMessageVersion(target, model),
  ]
}

export function removeMessageByKey(
  messages: Message[],
  messageKey: string
): Message[] {
  return messages.filter((message) => message.key !== messageKey)
}

export function getPreviousUserMessage(
  messages: Message[],
  beforeIndex: number
): Message | null {
  for (let index = beforeIndex - 1; index >= 0; index--) {
    if (messages[index].from === MESSAGE_ROLES.USER) {
      return messages[index]
    }
  }

  return null
}

export function applyMessageEdit(
  messages: Message[],
  messageKey: string,
  content: string,
  shouldSubmit: boolean,
  attachments?: ChatAttachment[],
  model?: string
): ApplyMessageEditResult | null {
  const submittedAt = Date.now()
  const messageIndex = messages.findIndex(
    (message) => message.key === messageKey
  )

  if (messageIndex === -1) {
    return null
  }

  const updatedMessages = messages.map((message) => {
    if (message.key !== messageKey) return message
    let nextAttachments = message.attachments
    if (message.from === MESSAGE_ROLES.USER && attachments !== undefined) {
      nextAttachments = attachments.length > 0 ? attachments : undefined
    }
    return {
      ...updateCurrentVersionContent(message, content),
      attachments: nextAttachments,
      createdAt: shouldSubmit ? submittedAt : message.createdAt,
    }
  })

  if (
    !shouldSubmit ||
    updatedMessages[messageIndex].from !== MESSAGE_ROLES.USER
  ) {
    return { messages: updatedMessages, shouldSend: false }
  }

  return {
    messages: [
      ...updatedMessages.slice(0, messageIndex + 1),
      createLoadingAssistantMessage(submittedAt, model),
    ],
    shouldSend: true,
  }
}

export function getEditingMessageContent(
  messages: Message[],
  editingKey?: string | null
): string {
  if (!editingKey) {
    return ''
  }

  const message = messages.find((item) => item.key === editingKey)
  return message ? getMessageContent(message) : ''
}

export function getChatMessageRenderState(
  messages: Message[],
  message: Message,
  messageIndex: number,
  editingKey?: string | null
): ChatMessageRenderState {
  return {
    alwaysShowActions:
      messageIndex === messages.length - 1 &&
      message.from === MESSAGE_ROLES.ASSISTANT,
    content: getMessageContent(message),
    isEditing: editingKey === message.key,
  }
}
