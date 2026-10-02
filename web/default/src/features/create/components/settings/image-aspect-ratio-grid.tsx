import { useTranslation } from 'react-i18next'

import { AspectGlyph } from '@/features/playground/components/composer/param-chip'
import { cn } from '@/lib/utils'

/**
 * Aspect ratio picker for aspect-based image models (Grok, Gemini): one
 * button per supported ratio with a proportional glyph, as a radio group.
 */
export function ImageAspectRatioGrid(props: {
  id: string
  ratios: string[]
  value: string | undefined
  onChange: (ratio: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      id={props.id}
      role='radiogroup'
      aria-label={t('Aspect ratio')}
      className='grid grid-cols-4 gap-1'
    >
      {props.ratios.map((ratio) => {
        const selected = ratio === props.value
        return (
          <button
            key={ratio}
            type='button'
            role='radio'
            aria-checked={selected}
            onClick={() => props.onChange(ratio)}
            className={cn(
              'flex h-12 flex-col items-center justify-center gap-1 rounded-md border text-2xs font-medium tabular-nums',
              'focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2',
              selected
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-border/70 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            )}
          >
            <span className='flex h-4 items-center justify-center'>
              <AspectGlyph size={ratio} />
            </span>
            {ratio === 'auto' ? t('Auto') : ratio}
          </button>
        )
      })}
    </div>
  )
}
