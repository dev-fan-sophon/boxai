import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

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

  // `fade-enter` sits on Empty itself rather than on a wrapper, so a caller's
  // sizing and padding classes land exactly once.
  return (
    <Empty
      className={cn(
        'fade-enter min-h-[220px]',
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
  )
}
