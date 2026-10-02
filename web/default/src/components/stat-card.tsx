import { useId, type ReactNode } from 'react'

import {
  Minus,
  TrendingDown,
  TrendingUp,
  type IconComponent,
} from '@/components/icons'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { tone, type Tone } from '@/lib/tone'
import { cn } from '@/lib/utils'

export type StatCardDelta = {
  label: string
  tone: Tone
  direction?: 'up' | 'down' | 'flat'
}

/**
 * `card` is a standalone tile, `subtle` a tile nested inside another surface
 * (sheet, dialog), and `none` leaves the surface to a caller that lays several
 * stats out in one shared frame (for example a divided grid).
 */
type StatCardSurface = 'card' | 'subtle' | 'none'

interface StatCardProps {
  label: string
  value: ReactNode
  /** Full value for the tooltip when `value` is abbreviated. */
  valueTitle?: string
  valueClassName?: string
  icon?: IconComponent
  iconTone?: IconBadgeTone
  /** Period-over-period change, rendered as a status chip. */
  delta?: StatCardDelta
  hint?: ReactNode
  /** Trend values drawn as a line under the value, in the icon tone. */
  sparkline?: number[]
  loading?: boolean
  /** Shows a `--` placeholder instead of a value that failed to load. */
  error?: boolean
  /** Smaller type and a plain icon, for secondary stats in detail panels. */
  compact?: boolean
  surface?: StatCardSurface
  className?: string
}

const SURFACE_CLASSES: Record<StatCardSurface, string> = {
  card: 'bg-card ring-border ring-1',
  subtle: 'bg-surface-subtle ring-border ring-1',
  none: '',
}

const SPARKLINE_TEXT: Record<IconBadgeTone, string> = {
  neutral: 'text-muted-foreground',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-info',
  destructive: 'text-destructive',
  'chart-1': 'text-chart-1',
  'chart-2': 'text-chart-2',
  'chart-3': 'text-chart-3',
  'chart-4': 'text-chart-4',
  'chart-5': 'text-chart-5',
}

const DELTA_ICONS: Record<
  NonNullable<StatCardDelta['direction']>,
  IconComponent
> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
}

const SPARKLINE_WIDTH = 160
const SPARKLINE_HEIGHT = 36
const SPARKLINE_PADDING = 3

function StatSparkline(props: { values: number[]; tone: IconBadgeTone }) {
  const gradientId = `stat-card-line-${useId().replaceAll(':', '')}`
  const values = props.values.map((value) => Math.max(0, Number(value) || 0))
  if (values.length === 0) return <div className='h-9' aria-hidden='true' />

  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min
  const points = values.map((value, index) => {
    const x =
      values.length === 1
        ? SPARKLINE_WIDTH / 2
        : (index / (values.length - 1)) * SPARKLINE_WIDTH
    let normalized = 0
    if (range > 0) {
      normalized = (value - min) / range
    } else if (max > 0) {
      normalized = 0.5
    }
    const y =
      SPARKLINE_HEIGHT -
      SPARKLINE_PADDING -
      normalized * (SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2)
    return { x, y }
  })
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')
  const firstX = points.at(0)?.x ?? 0
  const lastX = points.at(-1)?.x ?? SPARKLINE_WIDTH
  const areaPath = `${linePath} L ${lastX} ${SPARKLINE_HEIGHT} L ${firstX} ${SPARKLINE_HEIGHT} Z`

  return (
    <div
      className={cn(
        'relative h-9 overflow-hidden rounded-lg',
        SPARKLINE_TEXT[props.tone]
      )}
      aria-hidden='true'
    >
      <svg
        viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
        preserveAspectRatio='none'
        className='size-full'
      >
        <defs>
          <linearGradient id={gradientId} x1='0' x2='0' y1='0' y2='1'>
            <stop offset='0%' stopColor='currentColor' stopOpacity='0.22' />
            <stop offset='100%' stopColor='currentColor' stopOpacity='0' />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          d={linePath}
          fill='none'
          stroke='currentColor'
          strokeLinecap='round'
          strokeLinejoin='round'
          strokeWidth='2.25'
          vectorEffect='non-scaling-stroke'
        />
      </svg>
    </div>
  )
}

/**
 * The one stat/KPI tile for the app: a label (with optional icon), a headline
 * value, and optional delta chip, hint line and sparkline. Loading and error
 * states keep the tile's footprint so grids do not jump when data arrives.
 */
export function StatCard(props: StatCardProps) {
  const Icon = props.icon
  const iconTone = props.iconTone ?? 'neutral'
  const surface = props.surface ?? 'card'
  const hasFooter = props.delta != null || props.hint != null
  const DeltaIcon = props.delta?.direction
    ? DELTA_ICONS[props.delta.direction]
    : null

  let label: ReactNode
  if (props.compact) {
    label = (
      <span className='text-muted-foreground text-3xs inline-flex min-w-0 items-center gap-1.5 font-medium tracking-wider uppercase'>
        {Icon && <Icon className='size-3 shrink-0' aria-hidden='true' />}
        <span className='truncate'>{props.label}</span>
      </span>
    )
  } else {
    label = (
      <div className='text-muted-foreground flex min-w-0 items-center gap-2 text-xs font-medium'>
        {Icon && (
          <IconBadge tone={iconTone} size='stat'>
            <Icon />
          </IconBadge>
        )}
        <span className='truncate'>{props.label}</span>
      </div>
    )
  }

  const valueSizeClassName = props.compact
    ? 'text-lg'
    : 'text-xl tracking-tight sm:text-2xl'
  let value: ReactNode
  if (props.loading) {
    value = (
      <Skeleton
        className={props.compact ? 'h-7 w-20' : 'h-7 w-16 sm:h-8 sm:w-24'}
      />
    )
  } else if (props.error) {
    value = (
      <div
        className={cn(
          'text-muted-foreground font-mono font-semibold tabular-nums',
          valueSizeClassName
        )}
      >
        --
      </div>
    )
  } else {
    value = (
      <div
        className={cn(
          'text-foreground max-w-full truncate font-mono font-semibold tabular-nums',
          valueSizeClassName,
          props.valueClassName
        )}
        title={props.valueTitle}
      >
        {props.value}
      </div>
    )
  }

  let footer: ReactNode = null
  if (hasFooter && props.loading) {
    footer = <Skeleton className='h-3.5 w-28' />
  } else if (hasFooter) {
    footer = (
      <div className='flex min-w-0 flex-col items-start gap-1'>
        {props.delta && (
          <span
            className={cn(
              'text-2xs inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 font-medium',
              tone(props.delta.tone)
            )}
          >
            {DeltaIcon && (
              <DeltaIcon className='size-3 shrink-0' aria-hidden='true' />
            )}
            <span className='truncate'>{props.delta.label}</span>
          </span>
        )}
        {props.hint != null && (
          <span className='text-muted-foreground text-2xs line-clamp-1'>
            {props.hint}
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex h-full min-w-0 flex-col',
        props.compact ? 'gap-1 rounded-lg' : 'gap-2 rounded-xl',
        surface !== 'none' && (props.compact ? 'p-3' : 'p-3 sm:p-4'),
        SURFACE_CLASSES[surface],
        props.className
      )}
    >
      {label}
      {value}
      {footer}
      {props.sparkline && (
        <div className='mt-auto pt-1'>
          <StatSparkline values={props.sparkline} tone={iconTone} />
        </div>
      )}
    </div>
  )
}
