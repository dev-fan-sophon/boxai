import NumberFlow from '@number-flow/react'
import { useTranslation } from 'react-i18next'

import { Layers } from '@/components/icons'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { MAX_STUDIO_BATCH_JOBS } from '@/features/playground/lib/studio/batch-plan'
import { cn } from '@/lib/utils'

type OutputUnit = 'image' | 'video'

/**
 * "One prompt, several results": the take count as a row of quick picks,
 * placed right under the prompt so it is found where the run is defined
 * rather than buried among the model parameters. The caller labels it.
 */
export function OutputCountPicker(props: {
  unit: OutputUnit
  value: number
  options: readonly number[]
  onChange: (value: number) => void
}) {
  const { t } = useTranslation()
  const label =
    props.unit === 'video' ? t('Videos per prompt') : t('Images per prompt')

  return (
    <SegmentedControl
      fullWidth
      size='sm'
      aria-label={label}
      value={String(props.value)}
      onValueChange={(value) => props.onChange(Number(value))}
      options={props.options.map((count) => ({
        value: String(count),
        label: `${count}`,
        'aria-label':
          props.unit === 'video'
            ? t('{{count}} videos', { count })
            : t('{{count}} images', { count }),
      }))}
      className='tabular-nums'
    />
  )
}

/**
 * What Generate will queue, as arithmetic the user can check:
 * prompts × takes = results. Variants (`{a|b}`) are folded into the total.
 */
export function RunPlanSummary(props: {
  unit: OutputUnit
  promptCount: number
  perPrompt: number
  total: number
  truncated: number
  className?: string
}) {
  const { t } = useTranslation()
  if (props.total < 2) return null
  const totalLabel =
    props.unit === 'video'
      ? t('{{count}} videos', { count: props.total })
      : t('{{count}} images', { count: props.total })
  const showMath = props.promptCount > 1 || props.perPrompt > 1

  return (
    <div
      className={cn(
        'bg-surface-sunken text-ui flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2',
        props.className
      )}
      aria-live='polite'
    >
      <Layers className='text-muted-foreground size-4' aria-hidden='true' />
      {showMath ? (
        <span className='text-muted-foreground min-w-0'>
          {t('{{prompts}} prompts × {{takes}} each', {
            prompts: props.promptCount,
            takes: props.perPrompt,
          })}
        </span>
      ) : null}
      <span className='ms-auto inline-flex items-baseline gap-1 font-semibold tabular-nums'>
        <span className='sr-only'>{totalLabel}</span>
        <span aria-hidden='true' className='inline-flex items-baseline gap-1'>
          <NumberFlow value={props.total} />
          <span className='font-medium'>
            {props.unit === 'video' ? t('videos') : t('images')}
          </span>
        </span>
      </span>
      {props.truncated > 0 && (
        <p className='text-warning text-2xs basis-full'>
          {t('{{count}} more skipped (max {{max}} per run)', {
            count: props.truncated,
            max: MAX_STUDIO_BATCH_JOBS,
          })}
        </p>
      )}
    </div>
  )
}
