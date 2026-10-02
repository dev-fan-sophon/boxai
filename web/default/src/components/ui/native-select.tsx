import * as React from 'react'

import { ChevronsUpDown } from '@/components/icons'
import { cn } from '@/lib/utils'

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'size'> & {
  size?: 'sm' | 'default'
}

function NativeSelect({
  className,
  size = 'default',
  ...props
}: NativeSelectProps) {
  return (
    <div
      className={cn(
        'group/native-select relative w-fit has-[select:disabled]:opacity-50',
        className
      )}
      data-slot='native-select-wrapper'
      data-size={size}
    >
      <select
        data-slot='native-select'
        data-size={size}
        className='border-input selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-foreground/40 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:hover:bg-muted dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 bg-card dark:bg-input/20 hover:border-foreground/25 transition-ui duration-control h-9 w-full min-w-0 appearance-none rounded-lg border py-1 pr-8 pl-3 text-sm shadow-[0_1px_2px_rgb(0_0_0/0.03)] outline-none select-none focus-visible:ring-0 disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:ring-3 data-[size=sm]:h-8 data-[size=sm]:py-0.5'
        {...props}
      />
      <ChevronsUpDown
        className='text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 select-none'
        aria-hidden='true'
        data-slot='native-select-icon'
      />
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<'option'>) {
  return (
    <option
      data-slot='native-select-option'
      className={cn('bg-[Canvas] text-[CanvasText]', className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<'optgroup'>) {
  return (
    <optgroup
      data-slot='native-select-optgroup'
      className={cn('bg-[Canvas] text-[CanvasText]', className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
