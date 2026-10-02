import * as React from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot='textarea'
      className={cn(
        'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/15 disabled:bg-muted aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:disabled:bg-muted dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 flex field-sizing-content max-h-96 min-h-16 w-full overflow-y-auto bg-card hover:border-foreground/25 rounded-lg border px-3 py-2 text-base shadow-[0_1px_2px_rgb(0_0_0/0.03)] transition-ui duration-control outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
