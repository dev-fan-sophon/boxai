import { toneText } from '@/lib/tone'
import { cn } from '@/lib/utils'

type GrowthTextProps = {
  value: number
  className?: string
}

/**
 * Render a period-over-period growth percent as `↑303%`, `↓12.4%`, or
 * `0%` (when no change). The arrow is encoded in the text so the value
 * still aligns inside a tabular column.
 */
/**
 * Growth past this is reported as `>999%`. A model going from a handful of
 * tokens to real traffic yields ratios like 990567%, which carry no more
 * meaning than "grew enormously" while wrecking the tabular column width.
 */
const GROWTH_DISPLAY_CAP = 999

export function GrowthText(props: GrowthTextProps) {
  const v = props.value
  if (!Number.isFinite(v) || v === 0) {
    return (
      <span
        className={cn(
          'text-muted-foreground font-mono tabular-nums',
          props.className
        )}
      >
        0%
      </span>
    )
  }
  const isUp = v > 0
  const magnitude = Math.abs(v)
  const capped = magnitude > GROWTH_DISPLAY_CAP
  return (
    <span
      className={cn(
        'font-mono tabular-nums',
        toneText(isUp ? 'success' : 'danger'),
        props.className
      )}
      title={capped ? `${isUp ? '+' : '-'}${magnitude.toFixed(1)}%` : undefined}
    >
      {isUp ? '↑' : '↓'}
      {capped
        ? `>${GROWTH_DISPLAY_CAP}`
        : magnitude.toFixed(magnitude >= 100 ? 0 : 1)}
      %
    </span>
  )
}
