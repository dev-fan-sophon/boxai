import { MESSAGE_ROLES, MESSAGE_STATUS } from '../../constants'
import type { Message, MessageSource } from '../../types'
import { parseThinkTags } from './message-reasoning-utils'

export function displaySourceTitle(source: MessageSource): string {
  const title = source.title.trim()
  const citationTitle =
    /^\d+$/.test(title) ||
    /^\[\s*\d+\s*\]$/.test(title) ||
    /^\(\s*\d+\s*\)$/.test(title)
  if (title && !citationTitle) return title
  if (source.domain?.trim()) return source.domain.trim()
  try {
    return new URL(source.href).hostname || source.href
  } catch {
    return source.href
  }
}

type MessageContentStateBase = {
  displayContent: string
  hasSources: boolean
  isAssistant: boolean
  showLoader: boolean
  showMessageContent: boolean
  sources: NonNullable<Message['sources']>
}

type MessageContentState = MessageContentStateBase &
  (
    | {
        hasReasoning: true
        reasoningContent: string
      }
    | {
        hasReasoning: false
        reasoningContent: undefined
      }
  )

function shouldShowMessageLoader(
  message: Message,
  isAssistant: boolean,
  versionContent: string
): boolean {
  return (
    isAssistant &&
    !message.isReasoningStreaming &&
    (message.status === MESSAGE_STATUS.LOADING ||
      (message.status === MESSAGE_STATUS.STREAMING && !versionContent))
  )
}

function shouldShowMessageContent(
  message: Message,
  versionContent: string
): boolean {
  return (
    (message.from === MESSAGE_ROLES.USER || !message.isReasoningStreaming) &&
    versionContent.length > 0
  )
}

function getDisplayContent(message: Message, versionContent: string): string {
  if (message.from !== MESSAGE_ROLES.ASSISTANT) {
    return versionContent
  }

  if (!versionContent.includes('<think>')) {
    return versionContent
  }

  return parseThinkTags(versionContent).visibleContent
}

export function getMessageContentState(
  message: Message,
  versionContent: string
): MessageContentState {
  const isAssistant = message.from === MESSAGE_ROLES.ASSISTANT
  const sources = message.sources ?? []
  const reasoningContent = isAssistant ? message.reasoning?.content : undefined
  const showLoader = shouldShowMessageLoader(
    message,
    isAssistant,
    versionContent
  )
  const showMessageContent = shouldShowMessageContent(message, versionContent)

  const baseState: MessageContentStateBase = {
    displayContent: getDisplayContent(message, versionContent),
    hasSources: sources.length > 0,
    isAssistant,
    showLoader,
    showMessageContent,
    sources,
  }

  if (reasoningContent) {
    return {
      ...baseState,
      hasReasoning: true,
      reasoningContent,
    }
  }

  return {
    ...baseState,
    hasReasoning: false,
    reasoningContent: undefined,
  }
}
