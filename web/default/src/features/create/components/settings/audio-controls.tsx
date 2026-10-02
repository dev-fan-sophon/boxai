import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  AUDIO_LANGUAGES,
  ELEVEN_OUTPUT_FORMATS,
} from '@/features/playground/lib/studio/audio-settings'

import { languageName, outputFormatLabel } from '../../lib/audio-format'

/** Labelled slider with its current value shown on the right. */
export function SliderRow(props: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  valueLabel: string
  hint?: string
  onChange: (value: number) => void
}) {
  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <Label htmlFor={props.id} className='text-xs'>
          {props.label}
        </Label>
        <span className='text-muted-foreground text-2xs font-medium tabular-nums'>
          {props.valueLabel}
        </span>
      </div>
      <Slider
        id={props.id}
        aria-label={props.label}
        value={[props.value]}
        min={props.min}
        max={props.max}
        step={props.step}
        onValueChange={(value) => {
          const next = Array.isArray(value) ? value[0] : value
          if (typeof next === 'number') props.onChange(next)
        }}
      />
      {props.hint && (
        <p className='text-muted-foreground text-2xs'>{props.hint}</p>
      )}
    </div>
  )
}

/** Labelled switch row. */
export function SwitchRow(props: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className='flex items-start justify-between gap-3'>
      <span className='min-w-0'>
        <span className='text-foreground block text-xs font-medium'>
          {props.label}
        </span>
        {props.hint && (
          <span className='text-muted-foreground text-2xs block'>
            {props.hint}
          </span>
        )}
      </span>
      <Switch checked={props.checked} onCheckedChange={props.onChange} />
    </label>
  )
}

export function LanguageSelect(props: {
  id: string
  value: string
  autoLabel: string
  onChange: (value: string) => void
}) {
  const { i18n } = useTranslation()
  return (
    <NativeSelect
      id={props.id}
      size='sm'
      className='w-full'
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      <NativeSelectOption value=''>{props.autoLabel}</NativeSelectOption>
      {AUDIO_LANGUAGES.map((code) => (
        <NativeSelectOption key={code} value={code}>
          {languageName(code, i18n.language)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}

export function OutputFormatSelect(props: {
  id: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <NativeSelect
      id={props.id}
      size='sm'
      className='w-full'
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {ELEVEN_OUTPUT_FORMATS.map((format) => (
        <NativeSelectOption key={format} value={format}>
          {outputFormatLabel(format)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}
