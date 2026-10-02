import { cn } from '@/lib/utils'

/**
 * A keyboard key or shortcut hint (`⌘K`, `Esc`, `Enter`). Inside a tooltip it
 * inverts to sit on the tooltip's dark surface (see `ui/tooltip.tsx`, which
 * already styles `data-slot='kbd'` children).
 */
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot='kbd'
      className={cn(
        "bg-muted text-muted-foreground text-3xs pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm border px-1 font-mono font-medium select-none [&_svg:not([class*='size-'])]:size-3",
        '[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background [[data-slot=tooltip-content]_&]:border-transparent',
        className
      )}
      {...props}
    />
  )
}

/** Groups the keys of a chord, e.g. `<KbdGroup><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup>`. */
function KbdGroup({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot='kbd-group'
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
