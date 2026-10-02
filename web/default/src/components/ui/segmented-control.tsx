import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { cva } from 'class-variance-authority'
import { motion } from 'motion/react'
import { useId, type ReactNode } from 'react'

import { MOTION_SPRING } from '@/lib/motion'
import { useControllableState } from '@/lib/use-controllable-state'
import { cn } from '@/lib/utils'

/*
 * Segmented control — a single choice between a few peer modes
 * (Single / Batch / Storyboard, Image / Video, Day / Week / Month).
 *
 * Built on Base UI's RadioGroup, so it is a real `radiogroup` of `radio`s:
 * one tab stop, arrow keys move and select, Home/End jump, and an optional
 * `name` submits the value with a form. Use `Tabs` instead when each option
 * owns a panel of content.
 *
 * The selected surface is one thumb shared through a per-instance `layoutId`,
 * so it slides between segments on the snappy spring rather than blinking.
 * The root `MotionConfig reducedMotion='user'` turns that slide into a cut.
 */

const segmentedControlVariants = cva(
  'relative isolate inline-flex items-stretch rounded-lg bg-muted p-0.5 text-muted-foreground data-disabled:opacity-50',
  {
    variants: {
      size: {
        sm: 'h-7',
        md: 'h-8',
      },
    },
    defaultVariants: { size: 'md' },
  }
)

const segmentedItemVariants = cva(
  'relative inline-flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap outline-none transition-ui duration-control select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-checked:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      size: {
        sm: "px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        md: "px-3 text-sm [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: { size: 'md' },
  }
)

export interface SegmentedControlOption<T extends string> {
  value: T
  label: ReactNode
  /** Leading icon, rendered before the label. */
  icon?: ReactNode
  disabled?: boolean
  /** Required when `label` is icon-only. */
  'aria-label'?: string
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedControlOption<T>[]
  value?: T
  defaultValue?: T
  onValueChange?: (value: T) => void
  size?: 'sm' | 'md'
  /** Stretch to the container, splitting it evenly between segments. */
  fullWidth?: boolean
  disabled?: boolean
  /** Submits the value under this name when inside a form. */
  name?: string
  className?: string
  /** Accessible name of the group, e.g. t('Generation mode'). */
  'aria-label'?: string
  'aria-labelledby'?: string
}

function SegmentedControl<T extends string>(props: SegmentedControlProps<T>) {
  const thumbId = useId()
  const size = props.size ?? 'md'
  const [value, setValue] = useControllableState<T>({
    prop: props.value,
    defaultProp: props.defaultValue,
    onChange: props.onValueChange,
  })

  return (
    <RadioGroupPrimitive
      data-slot='segmented-control'
      data-size={size}
      value={value ?? null}
      onValueChange={(next) => setValue(next as T)}
      disabled={props.disabled}
      name={props.name}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      className={cn(
        segmentedControlVariants({ size }),
        props.fullWidth ? 'flex w-full' : 'w-fit',
        props.className
      )}
    >
      {props.options.map((option) => (
        <RadioPrimitive.Root
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          aria-label={option['aria-label']}
          data-slot='segmented-control-item'
          className={cn(
            segmentedItemVariants({ size }),
            props.fullWidth && 'flex-1'
          )}
        >
          {value === option.value && (
            <motion.span
              layoutId={thumbId}
              aria-hidden='true'
              data-slot='segmented-control-thumb'
              className='bg-background dark:bg-input/40 dark:ring-input absolute inset-0 -z-10 rounded-md shadow-sm dark:ring-1'
              transition={MOTION_SPRING.snappy}
            />
          )}
          {option.icon}
          {option.label}
        </RadioPrimitive.Root>
      ))}
    </RadioGroupPrimitive>
  )
}

export { SegmentedControl }
