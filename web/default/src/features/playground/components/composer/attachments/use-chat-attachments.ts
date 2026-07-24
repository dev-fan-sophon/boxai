/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  extractDocumentText,
  isDocumentFile,
} from '../../../lib/attachments/document-extract'
import type { ChatAttachment } from '../../../types'

const MAX_CHAT_ATTACHMENTS = 4
const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_CHAT_PDF_BYTES = 10 * 1024 * 1024
const MAX_CHAT_DOCUMENT_BYTES = 10 * 1024 * 1024

/**
 * Chat attachments (images, PDFs, and office/text documents) with
 * file-dialog, paste, and drag-drop ingestion paths. Images and PDFs stay
 * in memory as data URLs; documents are extracted to plain text in the
 * browser and sent as text parts.
 */
export function useChatAttachments() {
  const { t } = useTranslation()
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [isAdding, setIsAdding] = useState(false)
  const isAddingRef = useRef(false)
  const operationRef = useRef(0)

  useEffect(
    () => () => {
      operationRef.current += 1
    },
    []
  )

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0 || isAddingRef.current) return
    const validFiles: Array<{
      file: File
      kind: 'image' | 'pdf' | 'document'
    }> = []
    for (const file of files) {
      const isPdf =
        file.type === 'application/pdf' ||
        (file.type === '' && /\.pdf$/i.test(file.name))
      const isImage = !isPdf && file.type.startsWith('image/')
      const isDocument = !isPdf && !isImage && isDocumentFile(file)
      if (!isImage && !isPdf && !isDocument) {
        toast.error(
          t(
            'Unsupported file type. Use images, PDF, Word, Excel, PowerPoint, or text files.'
          )
        )
        continue
      }
      if (isImage && file.size > MAX_CHAT_IMAGE_BYTES) {
        toast.error(t('Image is too large (max 8MB).'))
        continue
      }
      if (isPdf && file.size > MAX_CHAT_PDF_BYTES) {
        toast.error(t('PDF is too large (max 10MB).'))
        continue
      }
      if (isDocument && file.size > MAX_CHAT_DOCUMENT_BYTES) {
        toast.error(t('Document is too large (max 10MB).'))
        continue
      }
      let kind: 'image' | 'pdf' | 'document' = 'document'
      if (isImage) kind = 'image'
      if (isPdf) kind = 'pdf'
      validFiles.push({ file, kind })
    }

    const remaining = MAX_CHAT_ATTACHMENTS - attachments.length
    if (remaining <= 0) {
      toast.error(
        t('You can attach up to {{count}} files.', {
          count: MAX_CHAT_ATTACHMENTS,
        })
      )
      return
    }
    const acceptedFiles = validFiles.slice(0, remaining)
    if (acceptedFiles.length === 0) return
    if (validFiles.length > remaining) {
      toast.error(
        t('You can attach up to {{count}} files.', {
          count: MAX_CHAT_ATTACHMENTS,
        })
      )
    }

    const operation = operationRef.current + 1
    operationRef.current = operation
    isAddingRef.current = true
    setIsAdding(true)
    const results = await Promise.allSettled(
      acceptedFiles.map(({ file, kind }) => {
        if (kind === 'document') {
          return extractDocumentText(file).then(
            (textContent): ChatAttachment => ({
              id: crypto.randomUUID(),
              name: file.name,
              mimeType: file.type || 'text/plain',
              dataUrl: '',
              type: 'document',
              textContent,
            })
          )
        }
        return new Promise<ChatAttachment>((resolve, reject) => {
          const reader = new FileReader()
          reader.addEventListener(
            'load',
            () => {
              let dataUrl = String(reader.result)
              if (kind === 'pdf') {
                dataUrl = dataUrl.replace(
                  /^data:[^;]*;base64,/,
                  'data:application/pdf;base64,'
                )
              }
              resolve({
                id: crypto.randomUUID(),
                name: file.name,
                mimeType: kind === 'pdf' ? 'application/pdf' : file.type,
                dataUrl,
                type: kind === 'image' ? 'image' : 'file',
              })
            },
            { once: true }
          )
          reader.addEventListener('error', () => reject(reader.error), {
            once: true,
          })
          reader.readAsDataURL(file)
        })
      })
    )

    if (operationRef.current !== operation) return
    const failedIndex = results.findIndex(
      (result) => result.status === 'rejected'
    )
    if (failedIndex >= 0) {
      toast.error(
        t('Could not read {{name}}.', {
          name: acceptedFiles[failedIndex].file.name,
        })
      )
    } else {
      const loaded = results.map(
        (result) => (result as PromiseFulfilledResult<ChatAttachment>).value
      )
      setAttachments((prev) => [
        ...prev,
        ...loaded.slice(0, MAX_CHAT_ATTACHMENTS - prev.length),
      ])
    }
    if (operationRef.current === operation) {
      isAddingRef.current = false
      setIsAdding(false)
    }
  }

  const removeAt = (index: number) =>
    setAttachments((prev) => prev.filter((_, i) => i !== index))

  const clear = () => {
    operationRef.current += 1
    isAddingRef.current = false
    setIsAdding(false)
    setAttachments([])
  }

  const handlePaste: React.ClipboardEventHandler = (event) => {
    const files = [...event.clipboardData.files].filter(
      (file) =>
        file.type.startsWith('image/') ||
        file.type === 'application/pdf' ||
        (file.type === '' && /\.pdf$/i.test(file.name)) ||
        isDocumentFile(file)
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
    isAdding,
    isFull: attachments.length >= MAX_CHAT_ATTACHMENTS,
  }
}
