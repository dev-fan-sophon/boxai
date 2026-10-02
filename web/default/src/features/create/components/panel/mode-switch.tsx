import { motion } from 'motion/react'
import { useId } from 'react'

import { MOTION_SPRING } from '@/lib/motion'
import { cn } from '@/lib/utils'

type ModeOption<T extends string> = {
  value: T
  label: string
  description?: string
}

/**
 * Radio-group segmented control with a sliding thumb. Arrow keys move the
 * selection like native radios, so the whole control is one tab stop.
 */
export function ModeSwitch<T extends string>(props: {
  value: T
  options: Array<ModeOption<T>>
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}) {
  const layoutId = useId()
  const index = props.options.findIndex((item) => item.value === props.value)

  const move = (delta: number) => {
    const count = props.options.length
    const next = props.options[(index + delta + count) % count]
    if (next) props.onChange(next.value)
  }

  return (
    <div
      role='radiogroup'
      aria-label={props.ariaLabel}
      className={cn(
        'bg-muted/60 ring-border/50 grid auto-cols-fr grid-flow-col gap-0.5 rounded-xl p-0.5 ring-1',
        props.className
      )}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault()
          move(-1)
        }
      }}
    >
      {props.options.map((option) => {
        const active = option.value === props.value
        return (
          <button
            key={option.value}
            type='button'
            role='radio'
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={option.description}
            onClick={() => props.onChange(option.value)}
            className={cn(
              'focus-visible:ring-ring relative h-8 rounded-[0.6rem] px-2 text-xs font-semibold outline-none transition-colors focus-visible:ring-2',
              active
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={MOTION_SPRING.snappy}
                className='bg-background ring-border/60 absolute inset-0 rounded-[0.6rem] shadow-sm ring-1'
                aria-hidden='true'
              />
            )}
            <span className='relative'>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
