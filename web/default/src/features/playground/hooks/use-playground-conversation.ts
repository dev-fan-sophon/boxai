import { useCallback, useState } from 'react'

import {
  appendUserMessagePair,
  applyMessageEdit,
  createRegeneratedMessages,
  getMessageContent,
  removeMessageByKey,
} from '../lib'
import type { ChatAttachment, Message } from '../types'

type UsePlaygroundConversationOptions = {
  messages: Message[]
  updateMessages: (
    updater: Message[] | ((prev: Message[]) => Message[])
  ) => void
  sendChat: (messages: Message[]) => void
  routeTurn?: (messages: Message[], text: string) => Promise<void>
  /**
   * Server-owned agent turn. When present it replaces both the managed-tool
   * router and the legacy completion call. Until the server exposes mutation
   * and attachment protocols, those operations are blocked so local state
   * cannot diverge from server-owned history.
   */
  agentTurn?: (messages: Message[], text: string) => Promise<void>
  canSubmit: () => boolean
  /** Model stamped onto new assistant placeholders for provenance. */
  activeModel?: string
}

export function usePlaygroundConversation({
  messages,
  updateMessages,
  sendChat,
  routeTurn,
  agentTurn,
  canSubmit,
  activeModel,
}: UsePlaygroundConversationOptions) {
  const [editingMessageKey, setEditingMessageKey] = useState<string | null>(
    null
  )

  const handleSendMessage = useCallback(
    (text: string, attachments?: ChatAttachment[]): boolean => {
      if (!canSubmit()) return false
      if (agentTurn && attachments?.length) return false
      const nextMessages = appendUserMessagePair(
        messages,
        text,
        attachments,
        activeModel
      )
      updateMessages(nextMessages)
      const isPlainTextTurn = Boolean(text.trim()) && !attachments?.length
      if (agentTurn && isPlainTextTurn) {
        void agentTurn(nextMessages, text)
      } else if (routeTurn && isPlainTextTurn) {
        void routeTurn(nextMessages, text)
      } else {
        sendChat(nextMessages)
      }
      return true
    },
    [
      canSubmit,
      messages,
      updateMessages,
      sendChat,
      routeTurn,
      agentTurn,
      activeModel,
    ]
  )

  const handleRegenerateMessage = useCallback(
    (message: Message) => {
      if (agentTurn || !canSubmit()) return
      const nextMessages = createRegeneratedMessages(
        messages,
        message.key,
        activeModel
      )
      if (!nextMessages) return

      updateMessages(nextMessages)
      const messageIndex = messages.findIndex(
        (item) => item.key === message.key
      )
      const precedingUser = messages
        .slice(0, messageIndex + (message.from === 'user' ? 1 : 0))
        .reverse()
        .find((item) => item.from === 'user')
      const precedingText = precedingUser
        ? getMessageContent(precedingUser)
        : ''
      if (
        routeTurn &&
        precedingText.trim() &&
        !precedingUser?.attachments?.length
      ) {
        void routeTurn(nextMessages, precedingText)
      } else {
        sendChat(nextMessages)
      }
    },
    [
      agentTurn,
      canSubmit,
      messages,
      updateMessages,
      sendChat,
      routeTurn,
      activeModel,
    ]
  )

  const handleEditMessage = useCallback(
    (message: Message) => {
      if (agentTurn) return
      setEditingMessageKey(message.key)
    },
    [agentTurn]
  )

  const handleEditOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setEditingMessageKey(null)
    }
  }, [])

  const applyEdit = useCallback(
    (newContent: string, shouldSubmit: boolean) => {
      if (agentTurn || !editingMessageKey) return
      if (shouldSubmit && !canSubmit()) return

      const editResult = applyMessageEdit(
        messages,
        editingMessageKey,
        newContent,
        shouldSubmit,
        activeModel
      )
      if (!editResult) return

      setEditingMessageKey(null)
      updateMessages(editResult.messages)

      if (editResult.shouldSend) {
        const editedMessage = editResult.messages.find(
          (message) => message.key === editingMessageKey
        )
        if (
          routeTurn &&
          newContent.trim() &&
          !editedMessage?.attachments?.length
        ) {
          void routeTurn(editResult.messages, newContent)
        } else {
          sendChat(editResult.messages)
        }
      }
    },
    [
      canSubmit,
      agentTurn,
      editingMessageKey,
      messages,
      updateMessages,
      sendChat,
      routeTurn,
      activeModel,
    ]
  )

  const handleDeleteMessage = useCallback(
    (message: Message) => {
      if (agentTurn) return
      updateMessages((previousMessages) =>
        removeMessageByKey(previousMessages, message.key)
      )
    },
    [agentTurn, updateMessages]
  )

  return {
    editingMessageKey,
    handleSendMessage,
    handleRegenerateMessage,
    handleEditMessage,
    handleEditOpenChange,
    applyEdit,
    handleDeleteMessage,
  }
}
