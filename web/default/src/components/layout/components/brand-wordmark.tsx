import { cn } from '@/lib/utils'

type BrandWordmarkProps = {
  name: string
  className?: string
  /**
   * - 'default': primary brand treatment (headers)
   * - 'muted': softer on chrome that already has low contrast
   * - 'inverse': light label on dark surfaces
   */
  tone?: 'default' | 'muted' | 'inverse'
}

/**
 * Product wordmark. For the canonical name "BoxAI", "Box" stays neutral and
 * "AI" picks up brand weight + a coral accent so the mark feels designed
 * rather than a plain system-name string. Custom system names fall back to
 * plain text so white-label installs stay honest.
 */
export function BrandWordmark(props: BrandWordmarkProps) {
  const tone = props.tone ?? 'default'
  const trimmed = props.name.trim()
  const isBoxAI = /^box\s*ai$/i.test(trimmed)

  if (!isBoxAI) {
    return (
      <span
        className={cn(
          'truncate font-semibold tracking-tight',
          tone === 'inverse' && 'text-white',
          tone === 'muted' && 'text-muted-foreground',
          props.className
        )}
      >
        {props.name}
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-baseline font-semibold tracking-[-0.045em] select-none',
        props.className
      )}
      aria-label='BoxAI'
    >
      <span
        className={cn(
          'font-semibold',
          tone === 'default' && 'text-foreground',
          tone === 'muted' && 'text-foreground/90',
          tone === 'inverse' && 'text-white'
        )}
      >
        Box
      </span>
      <span
        className={cn(
          // AI is the product signal: coral gradient + slightly tighter track.
          'bg-gradient-to-br from-primary via-primary to-[color-mix(in_oklab,var(--primary)_65%,#f5a87a)] bg-clip-text font-bold tracking-[-0.065em] text-transparent',
          tone === 'inverse' &&
            'bg-gradient-to-br from-[#ff9a6b] via-[#f08050] to-[#e05a3a] bg-clip-text text-transparent'
        )}
      >
        AI
      </span>
    </span>
  )
}
