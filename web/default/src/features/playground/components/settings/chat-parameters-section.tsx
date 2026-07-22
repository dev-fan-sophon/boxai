/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
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

/**
 * Chat sampling parameters (temperature, top_p, …) with per-parameter
 * enable switches. Only enabled parameters are sent with requests.
 */
export function ChatParametersSection(props: { disabled?: boolean }) {
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
