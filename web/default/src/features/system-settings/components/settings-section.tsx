import type { ReactNode } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { useSuppressSettingsSectionHeader } from './settings-page-context'

type SettingsSectionProps = {
  title: string
  description?: ReactNode
  titleProps?: React.HTMLAttributes<HTMLHeadingElement>
  children: React.ReactNode
  className?: string
  /**
   * `card` (default) frames the section as one settings card. `plain` keeps a
   * bare column for sections that compose their own cards.
   */
  variant?: 'card' | 'plain'
}

/**
 * One settings concern. Renders as a card with a title and description; the
 * header is hidden when it would only repeat the page title.
 */
export function SettingsSection({
  title,
  description,
  titleProps,
  children,
  className,
  variant = 'card',
}: SettingsSectionProps) {
  const showHeader = !useSuppressSettingsSectionHeader(title)

  if (variant === 'plain') {
    return (
      <section className={cn('flex min-w-0 flex-col gap-4', className)}>
        {showHeader && (
          <div className='flex min-w-0 flex-col gap-1'>
            <h3
              {...titleProps}
              className={cn('text-base font-semibold', titleProps?.className)}
            >
              {title}
            </h3>
            {description ? (
              <p className='text-muted-foreground text-xs'>{description}</p>
            ) : null}
          </div>
        )}
        {children}
      </section>
    )
  }

  return (
    <Card className={cn('min-w-0 shrink-0 overflow-visible', className)}>
      {showHeader && (
        <CardHeader className='border-border/60 border-b'>
          <CardTitle>
            <h3 {...titleProps} className={titleProps?.className}>
              {title}
            </h3>
          </CardTitle>
          {description ? (
            <CardDescription className='text-xs'>{description}</CardDescription>
          ) : null}
        </CardHeader>
      )}
      {/* Form items are CSS grids; their tracks default to min-content, so a
          wide table or tab strip inside would push the card past the
          viewport. Let every field shrink and scroll its own overflow. */}
      <CardContent className='flex min-h-0 min-w-0 flex-1 flex-col gap-4 max-sm:px-4 [&_[data-slot=form-item]]:min-w-0 [&_[data-slot=form-item]>*]:min-w-0'>
        {children}
      </CardContent>
    </Card>
  )
}
