import { useCallback, useState } from 'react'

import type { ChatAttachment, Message } from '../types'

type UsePlaygroundConversationOptions = {
  messages: Message[]
  send: (text: string, attachments?: ChatAttachment[]) => Promise<boolean>
  regenerate: (message: Message) => void
  save: (
    message: Message,
    content: string,
    attachments: ChatAttachment[] | undefined,
    shouldSubmit: boolean
  ) => Promise<boolean>
  remove: (message: Message) => void
  canSubmit: () => boolean
}

export function usePlaygroundConversation({
  messages,
  send,
  regenerate,
  save,
  remove,
  canSubmit,
}: UsePlaygroundConversationOptions) {
  const [editingMessageKey, setEditingMessageKey] = useState<string | null>(
    null
  )

  const handleSendMessage = useCallback(
    (
      text: string,
      attachments?: ChatAttachment[]
    ): boolean | Promise<boolean> => {
      if (!canSubmit()) return false
      return send(text, attachments)
    },
    [canSubmit, send]
  )

  const handleRegenerateMessage = useCallback(
    (message: Message) => {
      if (!canSubmit()) return
      regenerate(message)
    },
    [canSubmit, regenerate]
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
    async (
      newContent: string,
      attachments: ChatAttachment[] | undefined,
      shouldSubmit: boolean
    ): Promise<boolean> => {
      if (!editingMessageKey) return false
      if (shouldSubmit && !canSubmit()) return false

      const message = messages.find((item) => item.key === editingMessageKey)
      if (!message) return false
      return save(message, newContent, attachments, shouldSubmit)
    },
    [canSubmit, editingMessageKey, messages, save]
  )

  const handleDeleteMessage = useCallback(
    (message: Message) => {
      remove(message)
    },
    [remove]
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
