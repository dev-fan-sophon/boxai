import { Check, ChevronDown, Proportions } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type ChipOption = {
  value: string
  label: string
  glyph?: ReactNode
  disabled?: boolean
  /** Secondary text shown under the label, e.g. why an option is disabled. */
  hint?: string
}

/**
 * One tap-to-open parameter chip (Midjourney-style imagine bar control).
 * The current value is always visible; options open in a compact popover.
 * Shared by the playground composer and workbench canvas nodes.
 */
export function ParamChip(props: {
  icon: ReactNode
  ariaLabel: string
  valueLabel: string
  options: ChipOption[]
  value: string
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={props.ariaLabel}
        title={props.ariaLabel}
        disabled={props.disabled}
        className={cn(
          'border-border/80 bg-background/70 text-foreground/85 inline-flex h-8 shrink-0 touch-manipulation items-center gap-1 rounded-full border px-2.5 text-xs font-medium',
          'hover:border-border hover:text-foreground focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          open && 'border-primary/50 text-foreground',
          props.className
        )}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className='text-muted-foreground [&>svg]:size-3.5'>
          {props.icon}
        </span>
        <span className='max-w-28 truncate'>{props.valueLabel}</span>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-3 transition-transform',
            open && 'rotate-180'
          )}
          aria-hidden='true'
        />
      </PopoverTrigger>
      <PopoverContent
        align='start'
        side='top'
        className='w-56 p-1.5'
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className='flex flex-col gap-0.5' role='listbox'>
          {props.options.map((option) => {
            const selected = option.value === props.value
            return (
              <button
                key={option.value}
                type='button'
                role='option'
                aria-selected={selected}
                disabled={option.disabled}
                title={option.hint}
                className={cn(
                  'flex min-h-9 items-center gap-2 rounded-md px-2 py-1 text-left text-sm',
                  'hover:bg-muted/70 focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2',
                  'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent',
                  selected && 'bg-muted text-foreground font-medium'
                )}
                onClick={() => {
                  props.onChange(option.value)
                  setOpen(false)
                }}
              >
                {option.glyph && (
                  <span className='text-muted-foreground flex w-6 shrink-0 items-center justify-center'>
                    {option.glyph}
                  </span>
                )}
                <span className='flex min-w-0 flex-1 flex-col'>
                  <span className='truncate'>{option.label}</span>
                  {option.hint ? (
                    <span className='text-muted-foreground truncate text-[11px] font-normal'>
                      {option.hint}
                    </span>
                  ) : null}
                </span>
                {selected && <Check className='text-primary size-4 shrink-0' />}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Tiny outline whose proportions follow a `WxH` size or `W:H` ratio string.
 * Falls back to a generic icon for `auto` / `adaptive`.
 */
export function AspectGlyph(props: { size: string }) {
  const match = /^(\d+)\s*[x:]\s*(\d+)$/i.exec(props.size)
  if (!match) {
    return <Proportions className='size-4' aria-hidden='true' />
  }
  const w = Number(match[1])
  const h = Number(match[2])
  const scale = 14 / Math.max(w, h)
  return (
    <span
      className='border-foreground/60 rounded-[3px] border-[1.5px]'
      style={{ width: Math.round(w * scale), height: Math.round(h * scale) }}
      aria-hidden='true'
    />
  )
}
