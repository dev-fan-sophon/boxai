import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

export type FenceView = 'preview' | 'code'

type FenceViewToggleProps = {
  view: FenceView
  onViewChange: (view: FenceView) => void
  /** i18n key for the preview segment, defaults to 'Preview'. */
  previewLabelKey?: string
}

/**
 * Compact Preview | Code segmented toggle shared by rich code fences
 * (mermaid, chart, html preview).
 */
export function FenceViewToggle(props: FenceViewToggleProps) {
  const { t } = useTranslation()
  const segments: Array<{ id: FenceView; label: string }> = [
    { id: 'preview', label: t(props.previewLabelKey ?? 'Preview') },
    { id: 'code', label: t('Code') },
  ]

  return (
    <div
      className='bg-muted/60 flex shrink-0 items-center gap-0.5 rounded-md p-0.5'
      role='tablist'
      aria-label={t('View mode')}
    >
      {segments.map((segment) => (
        <button
          key={segment.id}
          type='button'
          role='tab'
          aria-selected={props.view === segment.id}
          onClick={() => props.onViewChange(segment.id)}
          className={cn(
            'focus-visible:ring-ring rounded px-2 py-0.5 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2',
            props.view === segment.id
              ? 'bg-background text-primary shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {segment.label}
        </button>
      ))}
    </div>
  )
}
