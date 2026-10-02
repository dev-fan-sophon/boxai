import { useTranslation } from 'react-i18next'

import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputTextarea,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { SendIcon, SquareIcon } from '@/components/icons'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type ComposerShellProps = {
  text: string
  onTextChange: (value: string) => void
  onSubmit: (message: PromptInputMessage) => void
  placeholder: string
  disabled?: boolean
  canSubmit: boolean
  showStop?: boolean
  onStop?: () => void
  /** Attachment strip rendered between textarea and footer */
  attachments?: React.ReactNode
  /** Left footer toolbar (attach button, quick toggles, …) */
  tools?: React.ReactNode
  /** Right footer content before the send button (price hint, …) */
  trailing?: React.ReactNode
  /** Send button text; generation composers say what the click produces. */
  submitLabel?: string
  /** Enter adds a line and Ctrl/⌘+Enter sends (batch prompt lists). */
  newlineOnEnter?: boolean
  onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>
  onDrop?: React.DragEventHandler<HTMLDivElement>
  onDragOver?: React.DragEventHandler<HTMLDivElement>
  onDragLeave?: React.DragEventHandler<HTMLDivElement>
  /** Highlights the surface while files hover over the composer. */
  dragActive?: boolean
  className?: string
}

/**
 * Shared composer skeleton for all playground modes: textarea, attachment
 * strip, and a footer with tool slots plus the send/stop button. Sits in
 * normal document flow — no floating dock.
 */
export function ComposerShell(props: ComposerShellProps) {
  const { t } = useTranslation()

  return (
    <div
      className={cn('grid min-w-0 shrink-0 gap-2 px-1', props.className)}
      onDrop={props.onDrop}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
    >
      <PromptInput
        className='relative min-w-0'
        groupClassName={cn(
          'playground-composer-surface bg-card border-border/80 rounded-2xl overflow-hidden',
          // The composer manages its own disabled look; keep the InputGroup
          // from dimming the whole surface (and the Stop button) with it.
          'has-[[data-slot=input-group-control]:disabled]:opacity-100 has-[[data-slot=input-group-control]:disabled]:bg-card',
          'shadow-panel transition-[border-color,box-shadow] duration-control',
          'focus-within:border-ring focus-within:ring-ring/15 focus-within:ring-3',
          props.dragActive &&
            'border-primary/70 ring-primary/20 bg-primary/5 border-dashed ring-3',
          props.disabled && 'opacity-90'
        )}
        onSubmit={props.onSubmit}
      >
        <PromptInputTextarea
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          className='md:text-md min-h-12 px-4 pt-3.5 pb-1 text-base leading-6 sm:min-h-14'
          disabled={props.disabled}
          newlineOnEnter={props.newlineOnEnter}
          onChange={(event) => props.onTextChange(event.target.value)}
          onPaste={props.onPaste}
          placeholder={props.placeholder}
          value={props.text}
        />

        {props.attachments}

        <PromptInputFooter className='relative z-10 px-2 pt-1 pb-2 sm:px-2.5'>
          <div className='flex w-full min-w-0 items-center justify-between gap-1.5 sm:gap-2'>
            <div className='flex min-w-0 flex-1 items-center gap-1 overflow-hidden'>
              {props.tools}
            </div>
            <div className='flex shrink-0 items-center gap-1.5 sm:gap-2'>
              {props.trailing}
              {props.showStop ? (
                <PromptInputButton
                  className='bg-destructive/10 text-destructive hover:bg-destructive/15 h-9 min-w-9 touch-manipulation rounded-full font-medium sm:h-8 sm:px-3'
                  onClick={props.onStop}
                  variant='secondary'
                >
                  <SquareIcon weight='fill' size={16} />
                  <span className='hidden sm:inline'>{t('Stop')}</span>
                  <span className='sr-only sm:hidden'>{t('Stop')}</span>
                </PromptInputButton>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <PromptInputButton
                        className={cn(
                          'bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground h-9 min-w-9 touch-manipulation rounded-full px-0 font-medium disabled:opacity-100 sm:h-8 sm:px-3.5',
                          'transition-[background-color,color,transform] duration-control active:scale-[0.97]'
                        )}
                        disabled={!props.canSubmit || props.disabled}
                        type='submit'
                        variant='default'
                      />
                    }
                  >
                    <SendIcon size={16} />
                    <span className='hidden sm:inline'>
                      {props.submitLabel ?? t('Send')}
                    </span>
                    <span className='sr-only sm:hidden'>
                      {props.submitLabel ?? t('Send')}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {props.newlineOnEnter
                        ? t('Ctrl+Enter to send, Enter for a new line')
                        : t('Enter to send, Shift+Enter for a new line')}
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
