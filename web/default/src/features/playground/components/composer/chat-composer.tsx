import {
  Bot,
  FileText,
  Globe,
  Image,
  Paperclip,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  PromptInputButton,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { usePlaygroundStore } from '@/stores/playground-store'

import { getInputControlState, getSubmittableInputText } from '../../lib'
import { DOCUMENT_ACCEPT } from '../../lib/attachments/document-extract'
import type { ChatAttachment } from '../../types'
import { ModelBrandIcon } from '../catalog/model-brand-icon'
import { ChatAttachmentStrip } from './attachments/chat-attachments'
import { useChatAttachments } from './attachments/use-chat-attachments'
import { ComposerShell } from './composer'
import { useComposerText } from './use-composer'

type ToolMode = 'auto' | 'image' | 'video' | 'search' | 'document'

const TOOL_MODES: Array<{
  value: ToolMode
  labelKey: string
  Icon: LucideIcon
}> = [
  { value: 'auto', labelKey: 'Auto', Icon: Bot },
  { value: 'image', labelKey: 'Image', Icon: Image },
  { value: 'video', labelKey: 'Video', Icon: Video },
  { value: 'search', labelKey: 'Search', Icon: Globe },
  { value: 'document', labelKey: 'Document', Icon: FileText },
]

type ChatComposerProps = {
  onSubmit: (
    text: string,
    attachments?: ChatAttachment[]
  ) => boolean | Promise<boolean>
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  isModelLoading?: boolean
  onOpenModelCatalog?: () => void
  allowAttachments?: boolean
}

/**
 * Chat composer: shared composer skeleton plus image/PDF/document attachments
 * (file dialog, paste, drag-drop) and the high-frequency tools menu
 * (image/video/search modes). Model switching lives in the catalog; clearing
 * the session lives in the workspace header.
 */
export function ChatComposer(props: ChatComposerProps) {
  const { t } = useTranslation()
  const { text, setText } = useComposerText()
  const attachments = useChatAttachments()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const activeModel = usePlaygroundStore((state) => state.config.model)
  const models = usePlaygroundStore((state) => state.models)
  const groups = usePlaygroundStore((state) => state.groups)
  const toolMode = usePlaygroundStore((state) => state.chatTools.mode)
  const setChatTools = usePlaygroundStore((state) => state.setChatTools)
  const allowAttachments = props.allowAttachments !== false

  const { canSubmit, shouldShowStop } = getInputControlState({
    disabled: props.disabled,
    groups,
    hasAttachments: allowAttachments && attachments.attachments.length > 0,
    hasStopHandler: Boolean(props.onStop),
    isAddingAttachments: attachments.isAdding || attachments.isParsing,
    isGenerating: props.isGenerating,
    isModelLoading: props.isModelLoading,
    models,
    text,
  })

  const handleSubmit = async (message: PromptInputMessage) => {
    if (attachments.isAdding || attachments.isParsing) return
    const submittableText = getSubmittableInputText(message, props.disabled)
    const submittedAttachments = allowAttachments
      ? attachments.attachments
      : undefined
    if (!submittableText && !submittedAttachments?.length) return
    if (await props.onSubmit(submittableText ?? '', submittedAttachments)) {
      setText('')
      attachments.clear()
    }
  }

  const currentTool =
    TOOL_MODES.find((mode) => mode.value === toolMode) ?? TOOL_MODES[0]

  return (
    <ComposerShell
      text={text}
      onTextChange={setText}
      onSubmit={handleSubmit}
      placeholder={t('Ask anything')}
      disabled={props.disabled}
      canSubmit={canSubmit}
      showStop={shouldShowStop}
      onStop={props.onStop}
      onPaste={allowAttachments ? attachments.handlePaste : undefined}
      onDrop={
        allowAttachments
          ? (event) => {
              setDragActive(false)
              attachments.handleDrop(event)
            }
          : undefined
      }
      onDragOver={
        allowAttachments
          ? (event) => {
              attachments.handleDragOver(event)
              setDragActive(true)
            }
          : undefined
      }
      onDragLeave={
        allowAttachments
          ? (event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDragActive(false)
              }
            }
          : undefined
      }
      dragActive={allowAttachments && dragActive}
      attachments={
        allowAttachments ? (
          <ChatAttachmentStrip
            attachments={attachments.attachments}
            onRemove={attachments.removeAt}
            onRetry={attachments.retryAt}
          />
        ) : undefined
      }
      tools={
        <>
          {activeModel && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type='button'
                    aria-label={t('Switch model')}
                    onClick={props.onOpenModelCatalog}
                    disabled={!props.onOpenModelCatalog}
                    className={cn(
                      'border-border/60 bg-muted/40 text-foreground/85 flex h-8 max-w-[9.5rem] shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium outline-none sm:max-w-[13rem]',
                      'hover:bg-muted/70 hover:text-foreground focus-visible:ring-ring transition-colors focus-visible:ring-2',
                      !props.onOpenModelCatalog && 'pointer-events-none'
                    )}
                  />
                }
              >
                <ModelBrandIcon modelName={activeModel} size={14} />
                <span className='truncate font-mono'>{activeModel}</span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('Switch model')}</p>
              </TooltipContent>
            </Tooltip>
          )}
          {allowAttachments && (
            <>
              <input
                ref={fileInputRef}
                type='file'
                accept={`image/*,${DOCUMENT_ACCEPT}`}
                multiple
                disabled={props.disabled || attachments.isAdding}
                className='hidden'
                onChange={(event) => {
                  void attachments.addFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <PromptInputButton
                      aria-label={t('Attach images or documents')}
                      className='text-muted-foreground hover:text-foreground hover:bg-muted/70 font-medium'
                      disabled={
                        props.disabled ||
                        attachments.isAdding ||
                        attachments.isFull
                      }
                      onClick={() => fileInputRef.current?.click()}
                      variant='ghost'
                    >
                      <Paperclip size={16} />
                    </PromptInputButton>
                  }
                />
                <TooltipContent>
                  <p>{t('Attach images or documents')}</p>
                </TooltipContent>
              </Tooltip>
            </>
          )}

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={
                      <PromptInputButton
                        aria-label={t('Tool mode')}
                        aria-pressed={toolMode !== 'auto'}
                        className={cn(
                          'font-medium transition-colors',
                          toolMode === 'auto'
                            ? 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
                            : 'border-primary/40 bg-primary/10 text-primary border'
                        )}
                        variant='ghost'
                      >
                        <currentTool.Icon size={16} />
                      </PromptInputButton>
                    }
                  />
                }
              />
              <TooltipContent>
                <p>
                  {t('Tool mode')} · {t(currentTool.labelKey)}
                </p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align='start' sideOffset={8}>
              {TOOL_MODES.map((mode) => (
                <DropdownMenuItem
                  key={mode.value}
                  onClick={() =>
                    setChatTools({
                      mode: mode.value,
                      webSearch: mode.value === 'search',
                    })
                  }
                >
                  <mode.Icon className='size-4' />
                  {t(mode.labelKey)}
                  {toolMode === mode.value ? (
                    <span className='text-primary ml-auto text-xs'>●</span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  )
}
