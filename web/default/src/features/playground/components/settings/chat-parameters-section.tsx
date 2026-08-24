import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { usePlaygroundStore } from '@/stores/playground-store'

import {
  getParameterControlValueText,
  normalizeParameterNumberValue,
  PLAYGROUND_PARAMETER_CONTROLS,
  type PlaygroundParameterKey,
} from '../../lib/parameters/playground-parameters'
import type { PlaygroundReasoningLevel } from '../../types'

/**
 * Chat sampling parameters (temperature, top_p, …) with per-parameter
 * enable switches. Only enabled parameters are sent with requests.
 */
export function ChatParametersSection(props: {
  disabled?: boolean
  showReasoning?: boolean
}) {
  const { t } = useTranslation()
  const config = usePlaygroundStore((state) => state.config)
  const parameterEnabled = usePlaygroundStore((state) => state.parameterEnabled)
  const updateConfig = usePlaygroundStore((state) => state.updateConfig)
  const setParameterEnabled = usePlaygroundStore(
    (state) => state.setParameterEnabled
  )

  const updateParameterValue = (
    key: PlaygroundParameterKey,
    value: number | null
  ) => {
    if (key === 'seed') {
      updateConfig({ seed: value })
      return
    }
    updateConfig({ [key]: value ?? 0 })
  }

  return (
    <div className='grid gap-2.5'>
      {props.showReasoning !== false && (
        <ReasoningDepthControl disabled={props.disabled} />
      )}
      {PLAYGROUND_PARAMETER_CONTROLS.map((control) => {
        const enabled = parameterEnabled[control.key]
        const value = config[control.key]
        const controlId = `playground-settings-${control.key}`

        return (
          <div
            className={cn(
              'border-border/70 bg-background/60 grid gap-2 rounded-lg border p-2.5 transition-opacity',
              (!enabled || props.disabled) && 'opacity-55'
            )}
            key={control.key}
          >
            <div className='flex items-start justify-between gap-2'>
              <div className='min-w-0 space-y-0.5'>
                <div className='flex min-w-0 items-center gap-1.5'>
                  <label
                    className='truncate text-xs leading-5 font-medium'
                    htmlFor={controlId}
                  >
                    {t(control.labelKey)}
                  </label>
                  <Badge
                    className='h-4.5 max-w-24 shrink-0 px-1 font-mono text-[10px]'
                    variant='outline'
                  >
                    {t(getParameterControlValueText(control.key, value))}
                  </Badge>
                </div>
                <p className='text-muted-foreground text-[11px] leading-4'>
                  {t(control.descriptionKey)}
                </p>
              </div>

              <Switch
                aria-label={t('Enable {{parameter}}', {
                  parameter: t(control.labelKey),
                })}
                checked={enabled}
                disabled={props.disabled}
                onCheckedChange={(checked) =>
                  setParameterEnabled({ [control.key]: checked })
                }
                size='sm'
              />
            </div>

            {control.valueType === 'slider' ? (
              <Slider
                className='py-1'
                disabled={props.disabled || !enabled}
                id={controlId}
                max={control.max}
                min={control.min}
                onValueChange={(nextValue) => {
                  const firstValue = Array.isArray(nextValue)
                    ? nextValue[0]
                    : nextValue
                  updateParameterValue(
                    control.key,
                    normalizeParameterNumberValue(control.key, firstValue)
                  )
                }}
                step={control.step}
                value={[Number(value)]}
              />
            ) : (
              <Input
                disabled={props.disabled || !enabled}
                id={controlId}
                inputMode='numeric'
                max={control.max}
                min={control.min}
                onChange={(event) => {
                  updateParameterValue(
                    control.key,
                    normalizeParameterNumberValue(
                      control.key,
                      event.target.value
                    )
                  )
                }}
                step={control.step}
                type='number'
                value={value ?? ''}
                className='h-8'
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

const REASONING_LABELS: Record<PlaygroundReasoningLevel, string> = {
  'provider-default': 'Default',
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

function ReasoningDepthControl(props: { disabled?: boolean }) {
  const { t } = useTranslation()
  const config = usePlaygroundStore((state) => state.config)
  const models = usePlaygroundStore((state) => state.models)
  const updateConfig = usePlaygroundStore((state) => state.updateConfig)
  const selectedModel = models.find((model) => model.value === config.model)
  const supportedEfforts = selectedModel?.reasoningEfforts ?? []

  if (supportedEfforts.length === 0) return null

  const levels: PlaygroundReasoningLevel[] = [
    'provider-default',
    ...supportedEfforts,
  ]
  const configured = config.reasoningByModel[config.model]
  const selected = levels.some((level) => level === configured)
    ? configured
    : 'provider-default'

  return (
    <div className='border-border/70 bg-background/60 grid gap-2 rounded-lg border p-2.5'>
      <div className='space-y-0.5'>
        <label
          className='text-xs leading-5 font-medium'
          htmlFor='playground-settings-reasoning'
        >
          {t('Thinking depth')}
        </label>
        <p className='text-muted-foreground text-[11px] leading-4'>
          {t('Available levels are defined by the selected model metadata.')}
        </p>
      </div>
      <NativeSelect
        id='playground-settings-reasoning'
        size='sm'
        disabled={props.disabled}
        value={selected}
        onChange={(event) => {
          const next = levels.find((level) => level === event.target.value)
          if (!next) return
          updateConfig({
            reasoningByModel: {
              ...config.reasoningByModel,
              [config.model]: next,
            },
          })
        }}
      >
        {levels.map((level) => (
          <NativeSelectOption key={level} value={level}>
            {t(REASONING_LABELS[level])}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}
