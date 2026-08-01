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
  agentActions?: {
    send: (text: string, attachments?: ChatAttachment[]) => boolean
    regenerate: (message: Message) => void
    save: (message: Message, content: string, shouldSubmit: boolean) => void
    remove: (message: Message) => void
  }
  canSubmit: () => boolean
  /** Model stamped onto new assistant placeholders for provenance. */
  activeModel?: string
}

export function usePlaygroundConversation({
  messages,
  updateMessages,
  sendChat,
  routeTurn,
  agentActions,
  canSubmit,
  activeModel,
}: UsePlaygroundConversationOptions) {
  const [editingMessageKey, setEditingMessageKey] = useState<string | null>(
    null
  )

  const handleSendMessage = useCallback(
    (text: string, attachments?: ChatAttachment[]): boolean => {
      if (!canSubmit()) return false
      if (agentActions) return agentActions.send(text, attachments)
      const nextMessages = appendUserMessagePair(
        messages,
        text,
        attachments,
        activeModel
      )
      updateMessages(nextMessages)
      const isPlainTextTurn = Boolean(text.trim()) && !attachments?.length
      if (routeTurn && isPlainTextTurn) {
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
      agentActions,
      activeModel,
    ]
  )

  const handleRegenerateMessage = useCallback(
    (message: Message) => {
      if (!canSubmit()) return
      if (agentActions) {
        agentActions.regenerate(message)
        return
      }
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
      agentActions,
      canSubmit,
      messages,
      updateMessages,
      sendChat,
      routeTurn,
      activeModel,
    ]
  )

  const handleEditMessage = useCallback((message: Message) => {
    setEditingMessageKey(message.key)
  }, [])

  const handleEditOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setEditingMessageKey(null)
    }
  }, [])

  const applyEdit = useCallback(
    (newContent: string, shouldSubmit: boolean) => {
      if (!editingMessageKey) return
      if (shouldSubmit && !canSubmit()) return

      if (agentActions) {
        const message = messages.find((item) => item.key === editingMessageKey)
        if (!message) return
        setEditingMessageKey(null)
        agentActions.save(message, newContent, shouldSubmit)
        return
      }

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
      agentActions,
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
      if (agentActions) {
        agentActions.remove(message)
        return
      }
      updateMessages((previousMessages) =>
        removeMessageByKey(previousMessages, message.key)
      )
    },
    [agentActions, updateMessages]
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
