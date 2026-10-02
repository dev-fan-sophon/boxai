import { useTranslation } from 'react-i18next'

import { LobeIcon } from '@/lib/lobe-icon'

import { formatTokens } from '../lib/format'
import type { ModelRanking } from '../types'
import { ModelLink, VendorLink } from './entity-links'
import { GrowthText } from './growth-text'

type ModelLeaderboardProps = {
  rows: ModelRanking[]
  /** Density variant. `compact` is used inside per-category sections; the
   * default fits the larger overall "Top Models" section. */
  variant?: 'default' | 'compact'
  /** Optional cap (rows beyond this are dropped). */
  limit?: number
}

/**
 * Two-column model leaderboard list: "rank · model
 * (with vendor below) · tokens (with growth below)" rendering. Splits
 * `rows` evenly between the two columns so the visual rhythm matches a
 * single ranked list rather than two independent lists.
 *
 * Both the model name and vendor name are clickable: model jumps to
 * `/pricing/{modelName}` and vendor jumps to `/pricing?vendor={vendor}`.
 */
export function ModelLeaderboard(props: ModelLeaderboardProps) {
  const limited = props.limit ? props.rows.slice(0, props.limit) : props.rows
  const half = Math.ceil(limited.length / 2)
  const left = limited.slice(0, half)
  const right = limited.slice(half)
  const variant = props.variant ?? 'default'

  if (limited.length === 0) {
    return null
  }

  return (
    <div className='grid grid-cols-1 gap-x-8 md:grid-cols-2'>
      <ModelList rows={left} variant={variant} />
      {right.length > 0 && <ModelList rows={right} variant={variant} />}
    </div>
  )
}

function ModelList(props: {
  rows: ModelRanking[]
  variant: 'default' | 'compact'
}) {
  const { t } = useTranslation()
  const compact = props.variant === 'compact'
  return (
    <ul>
      {props.rows.map((row) => (
        <li
          key={row.model_name}
          className={
            compact
              ? 'flex items-center gap-3 py-2'
              : 'flex items-center gap-3 py-2.5'
          }
        >
          <span className='text-muted-foreground w-6 shrink-0 text-right text-xs font-medium tabular-nums'>
            {row.rank}.
          </span>
          <span className='bg-background ring-border/60 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1'>
            <LobeIcon name={row.vendor_icon} size={compact ? 16 : 18} />
          </span>
          <div className='min-w-0 flex-1'>
            <ModelLink
              modelName={row.model_name}
              className={
                compact
                  ? 'text-foreground block truncate font-mono text-xs font-medium'
                  : 'text-foreground block truncate font-mono text-sm font-medium'
              }
            >
              {row.model_name}
            </ModelLink>
            <p
              className={
                compact
                  ? 'text-muted-foreground text-2xs truncate'
                  : 'text-muted-foreground truncate text-xs'
              }
            >
              <VendorLink vendor={row.vendor}>{row.vendor}</VendorLink>
            </p>
          </div>
          <div className='shrink-0 text-right'>
            <div
              className={
                compact
                  ? 'text-foreground text-xs font-semibold tabular-nums'
                  : 'text-foreground text-sm font-semibold tabular-nums'
              }
            >
              {formatTokens(row.total_tokens)}
              {!compact && (
                <>
                  {' '}
                  <span className='text-muted-foreground font-normal'>
                    {t('tokens')}
                  </span>
                </>
              )}
            </div>
            <GrowthText
              value={row.growth_pct}
              className={compact ? 'text-3xs' : 'text-2xs'}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
