import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { FadeIn } from '@/components/page-enter'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
  /** Drop the dashed frame when the caller already provides a container. */
  bordered?: boolean
  className?: string
}

/**
 * The one empty-state layout for the app — the counterpart to `ErrorState`.
 * Features should reach for this instead of hand-rolling a dashed box, so the
 * icon, copy scale, spacing and fade-in stay identical everywhere.
 */
export function EmptyState(props: EmptyStateProps) {
  const Icon = props.icon
  // Mirror size classes onto FadeIn so `h-full` / `flex-1` parent chains still
  // work; keep the dashed frame + padding on Empty (rounded border lives there).
  const sizeClassName = cn('w-full', props.className)

  return (
    <FadeIn className={sizeClassName}>
      <Empty
        className={cn(
          'min-h-[220px] h-full',
          props.bordered !== false && 'border border-dashed',
          props.className
        )}
      >
        <EmptyHeader>
          {Icon && (
            <EmptyMedia variant='icon'>
              <Icon className='size-4' />
            </EmptyMedia>
          )}
          <EmptyTitle>{props.title}</EmptyTitle>
          {props.description != null && (
            <EmptyDescription>{props.description}</EmptyDescription>
          )}
        </EmptyHeader>
        {/* Truthiness, not a null check: callers commonly pass a conditional
         * like `hasFilters && <Button/>`, and an empty EmptyContent would still
         * add its gap below the copy. */}
        {props.action ? <EmptyContent>{props.action}</EmptyContent> : null}
      </Empty>
    </FadeIn>
  )
}
