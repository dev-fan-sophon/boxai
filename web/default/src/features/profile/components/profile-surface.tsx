import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** Soft surface used across the redesigned profile page. */
export function ProfileSurface(props: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <div
      className={cn(
        'border-border/50 bg-card/80 relative overflow-hidden rounded-2xl border shadow-[0_1px_0_0_color-mix(in_oklch,var(--foreground)_4%,transparent)] backdrop-blur-sm',
        props.padded && 'p-4 sm:p-5',
        props.className
      )}
    >
      {props.children}
    </div>
  )
}

export function ProfileSectionLabel(props: {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'mb-3 flex items-end justify-between gap-3 sm:mb-4',
        props.className
      )}
    >
      <div className='min-w-0'>
        <h2 className='text-foreground text-sm font-semibold tracking-tight sm:text-base'>
          {props.title}
        </h2>
        {props.description ? (
          <p className='text-muted-foreground mt-0.5 text-xs sm:text-sm'>
            {props.description}
          </p>
        ) : null}
      </div>
      {props.action}
    </div>
  )
}
