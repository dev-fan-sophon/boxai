/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
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
  sendChat: (messages: Message[], managedToolRunId?: number) => void
  routeTurn?: (messages: Message[], text: string) => Promise<void>
  canSubmit: () => boolean
}

export function usePlaygroundConversation({
  messages,
  updateMessages,
  sendChat,
  routeTurn,
  canSubmit,
}: UsePlaygroundConversationOptions) {
  const [editingMessageKey, setEditingMessageKey] = useState<string | null>(
    null
  )

  const handleSendMessage = useCallback(
    (text: string, attachments?: ChatAttachment[]): boolean => {
      if (!canSubmit()) return false
      const nextMessages = appendUserMessagePair(messages, text, attachments)
      updateMessages(nextMessages)
      if (routeTurn && text.trim() && !attachments?.length) {
        void routeTurn(nextMessages, text)
      } else {
        sendChat(nextMessages)
      }
      return true
    },
    [canSubmit, messages, updateMessages, sendChat, routeTurn]
  )

  const handleRegenerateMessage = useCallback(
    (message: Message) => {
      if (!canSubmit()) return
      const nextMessages = createRegeneratedMessages(messages, message.key)
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
    [canSubmit, messages, updateMessages, sendChat, routeTurn]
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

      const editResult = applyMessageEdit(
        messages,
        editingMessageKey,
        newContent,
        shouldSubmit
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
      editingMessageKey,
      messages,
      updateMessages,
      sendChat,
      routeTurn,
    ]
  )

  const handleDeleteMessage = useCallback(
    (message: Message) => {
      updateMessages((previousMessages) =>
        removeMessageByKey(previousMessages, message.key)
      )
    },
    [updateMessages]
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
