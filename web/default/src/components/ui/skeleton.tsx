import { cn } from '@/lib/utils'

/**
 * Loading placeholder. Uses the shared `skeleton-shimmer` sweep (see
 * `styles/index.css`), which falls back to a static block under reduced
 * motion. Decorative by default — announce the loading state on the region
 * (`aria-busy`) or with a visually hidden status, not per block.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='skeleton'
      aria-hidden='true'
      className={cn('skeleton-shimmer rounded-md', className)}
      {...props}
    />
  )
}

export { Skeleton }
