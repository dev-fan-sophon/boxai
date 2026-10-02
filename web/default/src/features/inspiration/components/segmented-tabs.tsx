import { useTranslation } from 'react-i18next'

import type { IconComponent } from '@/components/icons'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'

export type SegmentedTabOption<T extends string> = {
  value: T
  label: string
  icon?: IconComponent
}

type SegmentedTabsProps<T extends string> = {
  value: T
  onChange: (value: T) => void
  options: Array<SegmentedTabOption<T>>
  ariaLabel: string
  className?: string
}

/**
 * Inspiration's view and series switchers. A thin adapter over the shared
 * `SegmentedControl`, so the thumb slides between options like every other
 * peer-mode switch in the app while callers keep passing i18n keys.
 */
export function SegmentedTabs<T extends string>(props: SegmentedTabsProps<T>) {
  const { t } = useTranslation()
  return (
    <SegmentedControl
      aria-label={props.ariaLabel}
      value={props.value}
      onValueChange={props.onChange}
      className={cn('shrink-0', props.className)}
      options={props.options.map((option) => ({
        value: option.value,
        label: t(option.label),
        icon: option.icon ? (
          <option.icon className='size-4' aria-hidden='true' />
        ) : undefined,
      }))}
    />
  )
}
