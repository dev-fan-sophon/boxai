/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Globe, ImagePlus, Trash2Icon } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  PromptInputButton,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { usePlaygroundStore } from '@/stores/playground-store'

import { getInputControlState, getSubmittableInputText } from '../../lib'
import { ChatImageAttachmentStrip } from './attachments/chat-images'
import { useChatImageAttachments } from './attachments/use-chat-image-attachments'
import { ComposerShell } from './composer'
import { useComposerText } from './use-composer'

type ChatComposerProps = {
  onSubmit: (text: string, attachments?: string[]) => boolean
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  isModelLoading?: boolean
  hasMessages?: boolean
  onClearMessages?: () => void
}

/**
 * Chat composer: shared composer skeleton plus multi-image attachments
 * (file dialog, paste, drag-drop) and the high-frequency web-search
 * shortcut. Model and group selection live in the catalog and settings
 * panel; sampling parameters live in the settings panel.
 */
export function ChatComposer(props: ChatComposerProps) {
  const { t } = useTranslation()
  const { text, setText } = useComposerText()
  const images = useChatImageAttachments()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const models = usePlaygroundStore((state) => state.models)
  const groups = usePlaygroundStore((state) => state.groups)
  const webSearch = usePlaygroundStore((state) => state.chatTools.webSearch)
  const setChatTools = usePlaygroundStore((state) => state.setChatTools)

  const { canSubmit, shouldShowStop } = getInputControlState({
    disabled: props.disabled,
    groups,
    hasStopHandler: Boolean(props.onStop),
    isGenerating: props.isGenerating,
    isModelLoading: props.isModelLoading,
    models,
    text,
  })

  const handleSubmit = (message: PromptInputMessage) => {
    const submittableText = getSubmittableInputText(message, props.disabled)
    if (!submittableText && images.attachments.length === 0) return
    if (props.onSubmit(submittableText ?? '', images.attachments)) {
      setText('')
      images.clear()
    }
  }

  const handleClearMessages = () => {
    props.onClearMessages?.()
    setClearConfirmOpen(false)
    toast.success(t('Conversation cleared'))
  }

  return (
    <>
      <ComposerShell
        text={text}
        onTextChange={setText}
        onSubmit={handleSubmit}
        placeholder={t('Ask anything')}
        disabled={props.disabled}
        canSubmit={canSubmit}
        showStop={shouldShowStop}
        onStop={props.onStop}
        onPaste={images.handlePaste}
        onDrop={images.handleDrop}
        onDragOver={images.handleDragOver}
        attachments={
          <ChatImageAttachmentStrip
            attachments={images.attachments}
            onRemove={images.removeAt}
          />
        }
        tools={
          <>
            <input
              ref={fileInputRef}
              type='file'
              accept='image/*'
              multiple
              className='hidden'
              onChange={(event) => {
                void images.addFiles(event.target.files)
                event.target.value = ''
              }}
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <PromptInputButton
                    aria-label={t('Attach image')}
                    className='text-muted-foreground hover:text-foreground hover:bg-muted/70 font-medium'
                    disabled={props.disabled || images.isFull}
                    onClick={() => fileInputRef.current?.click()}
                    variant='ghost'
                  >
                    <ImagePlus size={16} />
                  </PromptInputButton>
                }
              />
              <TooltipContent>
                <p>{t('Attach image')}</p>
              </TooltipContent>
            </Tooltip>

            <button
              type='button'
              aria-pressed={webSearch}
              onClick={() => setChatTools({ webSearch: !webSearch })}
              className={cn(
                'inline-flex h-8 items-center gap-1 rounded-lg border border-transparent px-2 text-[11px] font-medium transition-colors',
                'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                webSearch
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
              )}
            >
              <Globe className='size-3.5' aria-hidden='true' />
              {t('Web search')}
            </button>

            <Tooltip>
              <TooltipTrigger
                render={
                  <PromptInputButton
                    aria-label={t('Clear chat history')}
                    className='text-muted-foreground hover:text-destructive hover:bg-destructive/10 font-medium'
                    disabled={
                      props.disabled ||
                      !props.hasMessages ||
                      !props.onClearMessages
                    }
                    onClick={() => setClearConfirmOpen(true)}
                    variant='ghost'
                  >
                    <Trash2Icon size={16} />
                  </PromptInputButton>
                }
              />
              <TooltipContent>
                <p>{t('Clear chat history')}</p>
              </TooltipContent>
            </Tooltip>
          </>
        }
      />

      <ConfirmDialog
        destructive
        desc={t(
          'All playground messages saved in this browser will be removed. This cannot be undone.'
        )}
        confirmText={t('Clear')}
        handleConfirm={handleClearMessages}
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={t('Clear chat history?')}
      />
    </>
  )
}
