import { Check, Paperclip, RotateCcw, Send, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CodeBlockEditor } from '@/components/ai-elements/code-block'
import { Button } from '@/components/ui/button'

import { getMessageEditorState } from '../../lib'
import { DOCUMENT_ACCEPT } from '../../lib/attachments/document-extract'
import type { ChatAttachment, Message } from '../../types'
import { ChatAttachmentStrip } from '../composer/attachments/chat-attachments'
import { useChatAttachments } from '../composer/attachments/use-chat-attachments'

type PlaygroundMessageEditorProps = {
  editText: string
  message: Message
  onCancelEdit?: (open: boolean) => void
  onEditTextChange: (text: string) => void
  onSaveEdit?: (
    newContent: string,
    attachments?: ChatAttachment[]
  ) => Promise<boolean>
  onSaveEditAndSubmit?: (
    newContent: string,
    attachments?: ChatAttachment[]
  ) => Promise<boolean>
  originalText: string
}

export function PlaygroundMessageEditor({
  editText,
  message,
  onCancelEdit,
  onEditTextChange,
  onSaveEdit,
  onSaveEditAndSubmit,
  originalText,
}: PlaygroundMessageEditorProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isSaving, setIsSaving] = useState(false)
  const attachments = useChatAttachments(message.attachments)
  const originalAttachmentIds = (message.attachments ?? [])
    .map((attachment) => `${attachment.assetId ?? 0}:${attachment.id}`)
    .join('|')
  const editedAttachmentIds = attachments.attachments
    .map((attachment) => `${attachment.assetId ?? 0}:${attachment.id}`)
    .join('|')
  const { canSave, hasChanged, showSaveAndSubmit } = getMessageEditorState(
    message,
    editText,
    originalText,
    {
      hasAttachments: attachments.attachments.length > 0,
      attachmentsChanged: originalAttachmentIds !== editedAttachmentIds,
      blocked: attachments.isAdding || attachments.isParsing,
    }
  )

  const save = async (submit: boolean) => {
    if (!canSave || isSaving) return
    const editedAttachments =
      message.from === 'user' ? attachments.attachments : undefined
    const transferredAssetIds = attachments.commit()
    let saved = false
    setIsSaving(true)
    try {
      saved =
        (submit
          ? await onSaveEditAndSubmit?.(editText, editedAttachments)
          : await onSaveEdit?.(editText, editedAttachments)) === true
      if (saved) {
        onCancelEdit?.(false)
      }
    } finally {
      if (!saved) attachments.reclaim(transferredAssetIds)
      setIsSaving(false)
    }
  }

  const reset = () => {
    onEditTextChange(originalText)
    attachments.reset()
  }

  const handleCancel = () => {
    if (
      hasChanged &&
      !window.confirm(
        t('You have unsaved changes. Are you sure you want to leave?')
      )
    ) {
      return
    }

    attachments.discardCreated()
    onCancelEdit?.(false)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancel()
      return
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (!canSave) return

      if (showSaveAndSubmit) {
        void save(true)
      } else {
        void save(false)
      }
    }
  }

  const editorActions = (
    <>
      {showSaveAndSubmit && (
        <Button
          aria-label={t('Save & Submit')}
          disabled={!canSave || isSaving}
          onClick={() => void save(true)}
          size='icon-sm'
          type='button'
        >
          <Send className='size-4' />
        </Button>
      )}

      <Button
        aria-label={t('Save')}
        disabled={!canSave || isSaving}
        onClick={() => void save(false)}
        size='icon-sm'
        type='button'
        variant={showSaveAndSubmit ? 'ghost' : 'default'}
      >
        <Check className='size-4' />
      </Button>

      {hasChanged && (
        <Button
          aria-label={t('Reset')}
          disabled={isSaving}
          onClick={reset}
          size='icon-sm'
          type='button'
          variant='ghost'
        >
          <RotateCcw className='size-4' />
        </Button>
      )}

      <Button
        aria-label={t('Cancel')}
        disabled={isSaving}
        onClick={handleCancel}
        size='icon-sm'
        type='button'
        variant='ghost'
      >
        <X className='size-4' />
      </Button>
    </>
  )

  return (
    <div className='space-y-2'>
      {message.from === 'user' && (
        <>
          <input
            ref={fileInputRef}
            type='file'
            accept={`image/*,${DOCUMENT_ACCEPT}`}
            multiple
            className='hidden'
            disabled={isSaving || attachments.isAdding || attachments.isFull}
            onChange={(event) => {
              void attachments.addFiles(event.target.files)
              event.target.value = ''
            }}
          />
          <ChatAttachmentStrip
            attachments={attachments.attachments}
            disabled={isSaving}
            onRemove={attachments.removeAt}
          />
        </>
      )}
      <CodeBlockEditor
        actions={
          <>
            {message.from === 'user' && (
              <Button
                aria-label={t('Attach images or documents')}
                disabled={
                  isSaving || attachments.isAdding || attachments.isFull
                }
                onClick={() => fileInputRef.current?.click()}
                size='icon-sm'
                type='button'
                variant='ghost'
              >
                <Paperclip className='size-4' />
              </Button>
            )}
            {editorActions}
          </>
        }
        ariaLabel={t('Edit')}
        className='my-0 group-[.is-assistant]:w-full group-[.is-assistant]:max-w-[78ch] group-[.is-user]:max-w-[85%] sm:group-[.is-user]:max-w-[62ch] md:group-[.is-user]:max-w-[68ch] lg:group-[.is-user]:max-w-[72ch]'
        language='markdown'
        onChange={onEditTextChange}
        onKeyDown={handleKeyDown}
        rows={8}
        title={
          <span className='inline-flex items-center gap-2'>
            <span>{t('Edit')}</span>
            <span className='text-muted-foreground normal-case'>
              {hasChanged ? t('Unsaved changes') : t('No changes')}
            </span>
          </span>
        }
        value={editText}
      />
    </div>
  )
}
