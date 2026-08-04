import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

const STYLES: Record<string, string> = {
  info: 'border-border bg-muted/40',
  tip: 'border-primary/30 bg-primary/5',
  warning: 'border-warning/40 bg-warning/10',
  danger: 'border-destructive/40 bg-destructive/10',
}

export function DocCallout(props: {
  type?: 'info' | 'tip' | 'warning' | 'danger' | string
  children: ReactNode
  className?: string
}) {
  const type = props.type || 'info'
  return (
    <div
      className={cn(
        'my-4 rounded-lg border px-4 py-3 text-sm leading-relaxed',
        STYLES[type] ?? STYLES.info,
        props.className
      )}
      data-callout={type}
    >
      {props.children}
    </div>
  )
}
