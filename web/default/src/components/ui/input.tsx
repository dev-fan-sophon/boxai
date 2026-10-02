import { Input as InputPrimitive } from '@base-ui/react/input'
import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot='input'
      className={cn(
        'border-input file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/15 disabled:bg-muted aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:disabled:bg-muted dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 bg-card hover:border-foreground/25 h-9 w-full min-w-0 rounded-lg border px-3 py-1 text-base shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-ui duration-control outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 aria-invalid:ring-inset md:text-sm',
        className
      )}
      {...props}
    />
  )
}

export { Input }
