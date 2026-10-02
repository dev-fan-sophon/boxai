import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

function Empty({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='empty'
      className={cn(
        'isolate flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-2xl border-dashed p-8 text-center text-balance',
        className
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='empty-header'
      className={cn('flex max-w-sm flex-col items-center gap-2', className)}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  'mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        // A raised tile with a soft brand halo, so an empty surface still
        // reads as designed rather than broken.
        icon: "relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-card text-foreground shadow-raised ring-1 ring-border before:absolute before:-inset-6 before:-z-10 before:rounded-full before:bg-[radial-gradient(closest-side,var(--brand-glow),transparent)] before:opacity-60 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

function EmptyMedia({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot='empty-icon'
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='empty-title'
      className={cn('text-base font-semibold tracking-tight', className)}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <div
      data-slot='empty-description'
      className={cn(
        'text-muted-foreground [&>a:hover]:text-primary text-sm/relaxed [&>a]:underline [&>a]:underline-offset-4',
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='empty-content'
      className={cn(
        'flex w-full max-w-sm min-w-0 flex-col items-center gap-2.5 text-sm text-balance',
        className
      )}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
}
