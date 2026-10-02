import type { ReactNode } from 'react'

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

const TONE_DOTS: Record<ModelPriceTone, string> = {
  input: 'bg-chart-3',
  output: 'bg-chart-2',
  cache: 'bg-chart-4',
  default: 'bg-muted-foreground/50',
}

/**
 * Row-based model price list: one scannable row per price type with a
 * quiet label (a coloured dot keys the tier) on the left and a tabular
 * price plus unit suffix right-aligned, so prices line up down a grid. Shared by the marketplace card and the model
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
    <div className={cn('space-y-1.5', props.className)}>
      {props.items.map((item) => (
        <div
          key={item.key}
          className='flex min-w-0 items-baseline justify-between gap-3'
        >
          <span className='text-muted-foreground inline-flex min-w-0 items-center gap-1.5 text-xs leading-5'>
            <span
              aria-hidden='true'
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                TONE_DOTS[item.tone ?? 'default']
              )}
            />
            <span className='truncate'>{item.label}</span>
          </span>
          <span
            className={cn(
              'whitespace-nowrap tabular-nums',
              item.emphasized
                ? 'text-foreground text-sm font-semibold'
                : 'text-muted-foreground text-sm font-medium'
            )}
          >
            {item.formatted}
            {props.unitSuffix && (
              <span className='text-muted-foreground text-2xs ml-0.5 font-normal'>
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
          <span className='text-xs leading-5'>&nbsp;</span>
          <span className='text-sm font-semibold'>&nbsp;</span>
        </div>
      ))}
    </div>
  )
}
