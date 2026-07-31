import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { cn } from '@/lib/utils'

import {
  SettingsControlGroup,
  SettingsSwitchField,
} from '../components/settings-form-layout'
import {
  localToUsdAmount,
  usdToLocalAmount,
  type LocalPriceCurrency,
} from './editing-currency'
import { numericDraftRegex } from './model-pricing-core'

export function PriceInput(props: {
  /** Canonical USD amount; conversion happens inside when a currency is set. */
  value: string
  placeholder?: string
  disabled?: boolean
  onChange: (usdValue: string) => void
  currency?: LocalPriceCurrency | null
  endAddonLabel?: string
}) {
  const { t } = useTranslation()
  const local = props.currency ?? null
  const [draft, setDraft] = useState(() =>
    local ? usdToLocalAmount(props.value, local) : ''
  )
  const focusedRef = useRef(false)

  useEffect(() => {
    if (!local || focusedRef.current) return
    setDraft(usdToLocalAmount(props.value, local))
  }, [props.value, local])

  const symbol = local ? local.symbol : '$'
  const endAddon = props.endAddonLabel ?? `${symbol}/1M`
  const placeholder =
    local && props.placeholder
      ? usdToLocalAmount(props.placeholder, local)
      : props.placeholder

  const handleLocalChange = (text: string) => {
    if (!numericDraftRegex.test(text)) return
    setDraft(text)
    props.onChange(local ? localToUsdAmount(text, local) : text)
  }

  return (
    <div className='space-y-1'>
      <InputGroup>
        <InputGroupAddon>{symbol}</InputGroupAddon>
        <InputGroupInput
          inputMode='decimal'
          value={local ? draft : props.value}
          placeholder={placeholder}
          disabled={props.disabled}
          onChange={(event) => {
            if (local) {
              handleLocalChange(event.target.value)
              return
            }
            props.onChange(event.target.value)
          }}
          onFocus={() => {
            focusedRef.current = true
          }}
          onBlur={() => {
            focusedRef.current = false
            if (local) setDraft(usdToLocalAmount(props.value, local))
          }}
        />
        <InputGroupAddon align='inline-end'>{endAddon}</InputGroupAddon>
      </InputGroup>
      {local && props.value !== '' && (
        <p className='text-muted-foreground text-xs'>
          {t('≈ ${{usd}}', { usd: props.value })}
        </p>
      )}
    </div>
  )
}

export function PriceLane(props: {
  title: string
  description: string
  placeholder: string
  value: string
  enabled: boolean
  disabled?: boolean
  currency?: LocalPriceCurrency | null
  onEnabledChange: (checked: boolean) => void
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const effectiveDisabled = props.disabled || !props.enabled

  let footnote = t('Disabled lanes are omitted on save.')
  if (props.enabled) {
    footnote = props.currency
      ? t('Price shown in {{code}}; saved as USD.', {
          code: props.currency.code,
        })
      : t('USD price per 1M tokens.')
  }

  return (
    <SettingsControlGroup
      className={cn('space-y-3', effectiveDisabled && 'opacity-75')}
      data-disabled={effectiveDisabled || undefined}
    >
      <SettingsSwitchField
        checked={props.enabled}
        disabled={props.disabled}
        onCheckedChange={props.onEnabledChange}
        label={props.title}
        description={props.description}
        aria-label={props.title}
      />
      <PriceInput
        value={props.value}
        placeholder={props.placeholder}
        disabled={effectiveDisabled}
        currency={props.currency}
        onChange={props.onChange}
      />
      <p className='text-muted-foreground text-xs'>{footnote}</p>
    </SettingsControlGroup>
  )
}
