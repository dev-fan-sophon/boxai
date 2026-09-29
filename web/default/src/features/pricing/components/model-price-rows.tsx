import type { ReactNode } from 'react'

import { tone } from '@/lib/tone'
import { cn } from '@/lib/utils'

type ModelPriceTone = 'input' | 'output' | 'cache' | 'default'

export interface ModelPriceRowItem {
  key: string
  label: string
  /** Pre-formatted price string including its currency symbol. */
  formatted: ReactNode
  tone?: ModelPriceTone
  /** Primary prices (input/output) render heavier than secondary ones. */
  emphasized?: boolean
}

const TONE_CLASSES: Record<ModelPriceTone, string> = {
  input: tone('info'),
  output: 'bg-chart-2/10 text-chart-2',
  cache: 'bg-chart-4/10 text-chart-4',
  default: 'bg-muted text-muted-foreground',
}

/**
 * Row-based model price list: one scannable row per price type with a
 * colored label chip on the left and an Arial (`font-price`) price plus
 * unit suffix on the right. Shared by the marketplace card and the model
 * details view so both render prices with the same layout and font.
 */
export function ModelPriceRows(props: {
  items: ModelPriceRowItem[]
  /** Appended to every price, e.g. `/1M` for token-based models. */
  unitSuffix?: string
  /**
   * Pad with invisible rows up to this count so cards in a grid keep their
   * divider and price rows on a shared line even when only some models price
   * a cache tier. A real row is reused as the spacer so the reserved height
   * tracks the row's own font metrics across breakpoints.
   */
  minRows?: number
  className?: string
}) {
  const padCount = Math.max(0, (props.minRows ?? 0) - props.items.length)
  return (
    <div className={cn('font-price space-y-1.5', props.className)}>
      {props.items.map((item) => (
        <div key={item.key} className='flex items-center justify-between gap-3'>
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-2xs leading-4 font-medium',
              TONE_CLASSES[item.tone ?? 'default']
            )}
          >
            {item.label}
          </span>
          <span
            className={cn(
              'whitespace-nowrap tabular-nums',
              item.emphasized
                ? 'text-foreground text-sm font-semibold sm:text-md'
                : 'text-muted-foreground text-sm font-medium'
            )}
          >
            {item.formatted}
            {props.unitSuffix && (
              <span className='text-muted-foreground text-2xs font-normal'>
                {props.unitSuffix}
              </span>
            )}
          </span>
        </div>
      ))}
      {Array.from({ length: padCount }, (_, index) => (
        <div
          key={`pad-${index}`}
          aria-hidden
          className='invisible flex items-center justify-between gap-3'
        >
          <span className='text-2xs inline-flex items-center rounded px-1.5 py-0.5 leading-4 font-medium'>
            &nbsp;
          </span>
          <span className='sm:text-md text-sm font-semibold'>&nbsp;</span>
        </div>
      ))}
    </div>
  )
}
