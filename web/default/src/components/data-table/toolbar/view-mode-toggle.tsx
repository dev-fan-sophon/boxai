import { useTranslation } from 'react-i18next'

import { Grid2X2, Table2 } from '@/components/icons'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import {
  DATA_TABLE_VIEW_MODES,
  type DataTableViewMode,
} from '../hooks/use-data-table-view-mode'

export type DataTableViewModeToggleProps = {
  value: DataTableViewMode
  onChange: (mode: DataTableViewMode) => void
  className?: string
}

type Segment = {
  value: DataTableViewMode
  icon: React.ComponentType<{ className?: string }>
  tooltip: string
}

/**
 * Reusable icon segmented control for switching a data table between table and
 * card views. Shared, accessible version of the local control used by the
 * model square (`pricing-toolbar.tsx`).
 */
export function DataTableViewModeToggle(props: DataTableViewModeToggleProps) {
  const { t } = useTranslation()

  const segments: Segment[] = [
    {
      value: DATA_TABLE_VIEW_MODES.CARD,
      icon: Grid2X2,
      tooltip: t('Card view'),
    },
    {
      value: DATA_TABLE_VIEW_MODES.TABLE,
      icon: Table2,
      tooltip: t('Table view'),
    },
  ]

  return (
    <div
      role='group'
      aria-label={t('View mode')}
      className={cn(
        'bg-muted inline-flex h-8 items-center rounded-lg p-0.5',
        props.className
      )}
    >
      {segments.map((segment) => {
        const Icon = segment.icon
        const isActive = segment.value === props.value
        return (
          <Tooltip key={segment.value}>
            <TooltipTrigger
              render={
                <button
                  type='button'
                  onClick={() => props.onChange(segment.value)}
                  aria-pressed={isActive}
                  className={cn(
                    'inline-flex h-full w-7 items-center justify-center rounded-md text-xs font-medium transition-ui',
                    isActive
                      ? 'bg-card text-foreground shadow-raised dark:bg-input/40'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className='size-3.5' />
                </button>
              }
            />
            <TooltipContent side='bottom' className='text-xs'>
              {segment.tooltip}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
