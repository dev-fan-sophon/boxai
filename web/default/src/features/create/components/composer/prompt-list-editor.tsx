import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ClipboardPaste, Plus, X } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  countPromptVariants,
  MAX_STUDIO_BATCH_JOBS,
} from '@/features/playground/lib/studio/batch-plan'
import { MOTION_TRANSITION } from '@/lib/motion'
import { cn } from '@/lib/utils'

import {
  newPromptRow,
  promptRowsFromText,
  type PromptRow,
} from '../../hooks/use-generation-controller'

type PromptListEditorProps = {
  rows: PromptRow[]
  onChange: (rows: PromptRow[]) => void
  /** Outputs each prompt produces, shown on every filled row. */
  outputsPerPrompt: number
  unit: 'image' | 'video'
  onSubmit: () => void
  /** Docked mobile variant: tighter rows, list scrolls inside a short box. */
  compact?: boolean
}

/**
 * The multi-prompt editor: one card per prompt, so each prompt can be long,
 * multi-line and edited on its own, instead of the old "one prompt per line"
 * textarea convention. Enter starts the next prompt, Shift+Enter breaks a
 * line, Backspace on an empty row removes it, and pasting several lines
 * fans them out into rows. Each row says what it will produce.
 */
export function PromptListEditor(props: PromptListEditorProps) {
  const { t } = useTranslation()
  const fields = useRef(new Map<string, HTMLTextAreaElement>())
  const [focusId, setFocusId] = useState<string | null>(null)
  const rows = props.rows
  const full = rows.length >= MAX_STUDIO_BATCH_JOBS

  useEffect(() => {
    if (!focusId) return
    const field = fields.current.get(focusId)
    if (!field) return
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocusId(null)
  }, [focusId, rows])

  const insertAfter = (index: number, inserted: PromptRow[]) => {
    const room = MAX_STUDIO_BATCH_JOBS - rows.length
    if (room <= 0) {
      toast.info(
        t('Up to {{count}} prompts per run.', { count: MAX_STUDIO_BATCH_JOBS })
      )
      return
    }
    const kept = inserted.slice(0, room)
    props.onChange([
      ...rows.slice(0, index + 1),
      ...kept,
      ...rows.slice(index + 1),
    ])
    setFocusId(kept.at(-1)?.id ?? null)
  }

  const updateRow = (id: string, text: string) =>
    props.onChange(rows.map((row) => (row.id === id ? { ...row, text } : row)))

  const removeRow = (index: number) => {
    if (rows.length <= 1) {
      props.onChange([newPromptRow()])
      return
    }
    const next = rows.filter((_, rowIndex) => rowIndex !== index)
    props.onChange(next)
    setFocusId(next[Math.max(0, index - 1)]?.id ?? null)
  }

  /** Multi-line paste into a row fans out into one row per line. */
  const pasteLines = (index: number, pasted: string) => {
    const lines = promptRowsFromText(pasted)
    if (lines.length < 2) return false
    const current = rows[index]
    const replaceCurrent = !current.text.trim()
    const [first, ...rest] = lines
    const base = replaceCurrent
      ? rows.map((row, rowIndex) =>
          rowIndex === index ? { ...row, text: first.text } : row
        )
      : rows
    const inserted = replaceCurrent ? rest : lines
    const room = MAX_STUDIO_BATCH_JOBS - base.length
    const kept = inserted.slice(0, Math.max(0, room))
    props.onChange([
      ...base.slice(0, index + 1),
      ...kept,
      ...base.slice(index + 1),
    ])
    if (kept.length < inserted.length) {
      toast.info(
        t('Up to {{count}} prompts per run.', { count: MAX_STUDIO_BATCH_JOBS })
      )
    }
    setFocusId(kept.at(-1)?.id ?? current.id)
    return true
  }

  const pasteFromClipboard = async () => {
    let pasted = ''
    try {
      pasted = await navigator.clipboard.readText()
    } catch {
      toast.error(
        t('Clipboard access was blocked. Paste into a prompt instead.')
      )
      return
    }
    const lines = promptRowsFromText(pasted)
    if (lines.length === 0) {
      toast.info(t('The clipboard has no text to add.'))
      return
    }
    const filled = rows.filter((row) => row.text.trim())
    const room = MAX_STUDIO_BATCH_JOBS - filled.length
    props.onChange([...filled, ...lines.slice(0, Math.max(0, room))])
    toast.success(
      t('Added {{count}} prompts.', { count: Math.min(lines.length, room) })
    )
  }

  const unitLabel = (count: number) =>
    props.unit === 'video'
      ? t('{{count}} videos', { count })
      : t('{{count}} images', { count })

  return (
    <div className='space-y-2'>
      <ol
        className={cn(
          'space-y-2',
          props.compact &&
            'max-h-[38dvh] overflow-y-auto overscroll-contain pe-0.5'
        )}
        aria-label={t('Prompts')}
      >
        <AnimatePresence initial={false}>
          {rows.map((row, index) => {
            const variants = row.text.trim() ? countPromptVariants(row.text) : 0
            const outputs = variants * props.outputsPerPrompt
            return (
              <motion.li
                key={row.id}
                layout='position'
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={MOTION_TRANSITION.fast}
                className='group/prompt bg-card border-input focus-within:border-ring focus-within:ring-ring/15 hover:border-foreground/25 transition-ui duration-control relative rounded-xl border shadow-[0_1px_2px_rgb(0_0_0/0.03)] focus-within:ring-3'
              >
                <span
                  aria-hidden='true'
                  className='bg-muted text-muted-foreground group-focus-within/prompt:bg-primary group-focus-within/prompt:text-primary-foreground text-2xs transition-ui duration-control absolute top-2.5 left-2.5 flex size-5 items-center justify-center rounded-md font-semibold tabular-nums'
                >
                  {index + 1}
                </span>
                <textarea
                  ref={(node) => {
                    if (node) fields.current.set(row.id, node)
                    else fields.current.delete(row.id)
                  }}
                  value={row.text}
                  rows={1}
                  aria-label={t('Prompt {{index}}', { index: index + 1 })}
                  placeholder={
                    index === 0
                      ? t('Describe the first shot…')
                      : t('Another prompt…')
                  }
                  className={cn(
                    'placeholder:text-muted-foreground/70 block field-sizing-content w-full resize-none bg-transparent py-2.5 ps-9 pe-9 text-sm leading-relaxed outline-none',
                    props.compact ? 'max-h-28 min-h-10' : 'max-h-48 min-h-11'
                  )}
                  onChange={(event) => updateRow(row.id, event.target.value)}
                  onPaste={(event) => {
                    const pasted = event.clipboardData.getData('text')
                    if (pasteLines(index, pasted)) event.preventDefault()
                  }}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return
                    if (
                      event.key === 'Enter' &&
                      (event.metaKey || event.ctrlKey)
                    ) {
                      event.preventDefault()
                      props.onSubmit()
                      return
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      insertAfter(index, [newPromptRow()])
                      return
                    }
                    if (
                      event.key === 'Backspace' &&
                      !row.text &&
                      rows.length > 1
                    ) {
                      event.preventDefault()
                      removeRow(index)
                    }
                  }}
                />
                <button
                  type='button'
                  aria-label={t('Remove prompt {{index}}', {
                    index: index + 1,
                  })}
                  className='text-muted-foreground hover:bg-accent hover:text-foreground transition-ui duration-control absolute top-2 right-2 flex size-6 items-center justify-center rounded-md opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-focus-within/prompt:opacity-100 sm:group-hover/prompt:opacity-100'
                  onClick={() => removeRow(index)}
                >
                  <X className='size-3.5' aria-hidden='true' />
                </button>
                {outputs > 1 && (
                  <span className='text-muted-foreground text-2xs -mt-1 block px-9 pb-2 tabular-nums'>
                    {variants > 1
                      ? t('{{variants}} variants · {{outputs}}', {
                          variants,
                          outputs: unitLabel(outputs),
                        })
                      : unitLabel(outputs)}
                  </span>
                )}
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ol>
      <div className='flex flex-wrap items-center gap-1.5'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={full}
          onClick={() => insertAfter(rows.length - 1, [newPromptRow()])}
        >
          <Plus aria-hidden='true' />
          {t('Add prompt')}
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='text-muted-foreground'
          disabled={full}
          onClick={() => void pasteFromClipboard()}
        >
          <ClipboardPaste aria-hidden='true' />
          {t('Paste list')}
        </Button>
        <span className='text-muted-foreground text-2xs ms-auto tabular-nums'>
          {rows.length}/{MAX_STUDIO_BATCH_JOBS}
        </span>
      </div>
    </div>
  )
}
