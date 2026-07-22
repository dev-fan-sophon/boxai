/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const MAX_CHAT_IMAGE_ATTACHMENTS = 4
const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024

/**
 * Chat image attachments (data URLs, ≤4 images ≤8MB) with file-dialog,
 * paste, and drag-drop ingestion paths.
 */
export function useChatImageAttachments() {
  const { t } = useTranslation()
  const [attachments, setAttachments] = useState<string[]>([])

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return
    const list = [...files]
    const remaining = MAX_CHAT_IMAGE_ATTACHMENTS - attachments.length
    if (remaining <= 0) {
      toast.error(
        t('You can attach up to {{count}} images.', {
          count: MAX_CHAT_IMAGE_ATTACHMENTS,
        })
      )
      return
    }
    for (const file of list.slice(0, remaining)) {
      if (!file.type.startsWith('image/')) {
        toast.error(t('Only image attachments are supported.'))
        continue
      }
      if (file.size > MAX_CHAT_IMAGE_BYTES) {
        toast.error(t('Image is too large (max 8MB).'))
        continue
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.addEventListener('load', () => resolve(String(reader.result)), {
          once: true,
        })
        reader.addEventListener('error', () => reject(reader.error), {
          once: true,
        })
        reader.readAsDataURL(file)
      })
      setAttachments((prev) =>
        prev.length < MAX_CHAT_IMAGE_ATTACHMENTS ? [...prev, dataUrl] : prev
      )
    }
  }

  const removeAt = (index: number) =>
    setAttachments((prev) => prev.filter((_, i) => i !== index))

  const clear = () => setAttachments([])

  const handlePaste: React.ClipboardEventHandler = (event) => {
    const files = [...event.clipboardData.files].filter((file) =>
      file.type.startsWith('image/')
    )
    if (files.length === 0) return
    event.preventDefault()
    void addFiles(files)
  }

  const handleDrop: React.DragEventHandler = (event) => {
    if (event.dataTransfer.files.length === 0) return
    event.preventDefault()
    void addFiles(event.dataTransfer.files)
  }

  const handleDragOver: React.DragEventHandler = (event) => {
    if ([...event.dataTransfer.types].includes('Files')) {
      event.preventDefault()
    }
  }

  return {
    attachments,
    addFiles,
    removeAt,
    clear,
    handlePaste,
    handleDrop,
    handleDragOver,
    isFull: attachments.length >= MAX_CHAT_IMAGE_ATTACHMENTS,
  }
}
