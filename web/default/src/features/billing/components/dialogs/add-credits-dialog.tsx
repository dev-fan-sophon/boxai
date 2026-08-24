import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import {
  convertUsdToLocalAmount,
  formatCurrencyFromUSD,
  formatLocalCurrencyAmount,
  formatUSDAmount,
  getCurrencyDisplay,
  getCurrencyLabel,
  isCurrencyDisplayEnabled,
  isNonUsdCurrencyDisplay,
} from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  formatCurrency,
  getDiscountLabel,
  getPaymentIcon,
  getMinTopupAmount,
  isBankQRPayment,
} from '../../lib'
import type {
  CreemProduct,
  PaymentMethod,
  PresetAmount,
  TopupInfo,
  WaffoPayMethod,
} from '../../types'
import { CreemProductsSection } from '../creem-products-section'

interface AddCreditsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  topupInfo: TopupInfo | null
  presetAmounts: PresetAmount[]
  selectedPreset: number | null
  onSelectPreset: (preset: PresetAmount) => void
  topupAmount: number
  onTopupAmountChange: (amount: number) => void
  paymentAmount: number
  calculating: boolean
  selectedPaymentMethod?: PaymentMethod
  onPaymentMethodSelect: (method: PaymentMethod) => void
  onContinueToPay: () => void
  paymentLoading: string | null
  creemProducts?: CreemProduct[]
  onCreemProductSelect?: (product: CreemProduct) => void
  waffoPayMethods?: WaffoPayMethod[]
  onWaffoMethodSelect?: (method: WaffoPayMethod, index: number) => void
}

function StepHeader(props: { step: string; title: string }) {
  return (
    <div className='flex items-center gap-2.5'>
      <span className='bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-bold'>
        {props.step}
      </span>
      <h3 className='text-sm font-semibold'>{props.title}</h3>
    </div>
  )
}

type CustomAmountUnit = 'local' | 'usd'

const USD_AMOUNT_FORMAT = {
  digitsLarge: 2,
  digitsSmall: 2,
  abbreviate: false,
} as const

const LOCAL_AMOUNT_FORMAT = {
  abbreviate: false,
} as const

function formatPresetCredit(amount: number): string {
  if (!isCurrencyDisplayEnabled()) {
    return formatNumber(amount)
  }
  const { meta } = getCurrencyDisplay()
  if (meta.kind === 'currency' && meta.currencyCode === 'VND') {
    return formatLocalCurrencyAmount(amount, LOCAL_AMOUNT_FORMAT)
  }
  return formatCurrencyFromUSD(amount, LOCAL_AMOUNT_FORMAT)
}

function formatPresetUsd(amount: number): string {
  const { meta } = getCurrencyDisplay()
  if (meta.kind === 'currency' && meta.currencyCode === 'VND') {
    return formatUSDAmount(amount / meta.exchangeRate, USD_AMOUNT_FORMAT)
  }
  return formatUSDAmount(amount, USD_AMOUNT_FORMAT)
}

function roundUsdCents(amountUsd: number): number {
  return Math.round(amountUsd * 100) / 100
}

function formatCustomDraft(amount: number, unit: CustomAmountUnit): string {
  if (!(Number.isFinite(amount) && amount > 0)) return ''
  if (unit === 'usd') {
    const { meta } = getCurrencyDisplay()
    if (meta.kind === 'currency' && meta.currencyCode === 'VND') {
      return String(roundUsdCents(amount / meta.exchangeRate))
    }
    return String(roundUsdCents(amount))
  }
  return String(Math.round(amount))
}

function parseCustomDraft(value: string, unit: CustomAmountUnit): number {
  if (unit === 'usd') {
    const usd = Number.parseFloat(value) || 0
    const local = convertUsdToLocalAmount(usd)
    if (local == null) return roundUsdCents(usd)
    return Math.round(local)
  }
  return Math.round(Number.parseFloat(value) || 0)
}

/**
 * Top-up wizard: amount → payment method → confirm. The final confirmation
 * happens in the layered PaymentConfirmDialog owned by the billing page.
 */
export function AddCreditsDialog(props: AddCreditsDialogProps) {
  const { t, i18n } = useTranslation()
  const showUsdUnit = isNonUsdCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const [customUnit, setCustomUnit] = useState<CustomAmountUnit>('local')
  const [localAmount, setLocalAmount] = useState(() =>
    formatCustomDraft(props.topupAmount, showUsdUnit ? 'local' : 'usd')
  )
  const [termsAccepted, setTermsAccepted] = useState(false)
  const customAmountFocusedRef = useRef(false)

  useEffect(() => {
    if (customAmountFocusedRef.current) return
    setLocalAmount(
      formatCustomDraft(props.topupAmount, showUsdUnit ? customUnit : 'usd')
    )
  }, [customUnit, props.topupAmount, showUsdUnit])

  const handleAmountChange = (value: string) => {
    setLocalAmount(value)
    const parsed = parseCustomDraft(value, showUsdUnit ? customUnit : 'usd')
    if (parsed >= 0) props.onTopupAmountChange(parsed)
  }

  const handleCustomUnitChange = (unit: CustomAmountUnit) => {
    if (unit === customUnit) return
    setCustomUnit(unit)
    setLocalAmount(formatCustomDraft(props.topupAmount, unit))
  }

  const enableCreem = !!props.topupInfo?.enable_creem_topup
  const enableWaffo = !!props.topupInfo?.enable_waffo_topup
  const hasConfigurableTopup =
    props.topupInfo?.enable_online_topup ||
    props.topupInfo?.enable_stripe_topup ||
    props.topupInfo?.enable_bank_qr_topup ||
    enableWaffo ||
    props.topupInfo?.enable_waffo_pancake_topup
  const hasStandardMethods =
    Array.isArray(props.topupInfo?.pay_methods) &&
    props.topupInfo.pay_methods.length > 0
  const hasWaffoMethods =
    Array.isArray(props.waffoPayMethods) && props.waffoPayMethods.length > 0
  const hasCreemProducts =
    enableCreem &&
    Array.isArray(props.creemProducts) &&
    props.creemProducts.length > 0

  const effectiveMin = Math.max(
    getMinTopupAmount(props.topupInfo),
    props.selectedPaymentMethod?.min_topup || 0
  )
  // Bank QR settles in VND regardless of the site display currency.
  const formatAmountDue = (amount: number) => {
    if (
      props.selectedPaymentMethod &&
      isBankQRPayment(props.selectedPaymentMethod.type)
    ) {
      return new Intl.NumberFormat(toIntlLocale(i18n.language), {
        style: 'currency',
        currency: 'VND',
        maximumFractionDigits: 0,
      }).format(amount)
    }
    return formatCurrency(amount)
  }

  const canContinue =
    Boolean(props.selectedPaymentMethod) &&
    props.topupAmount >= effectiveMin &&
    termsAccepted &&
    !props.paymentLoading

  let formattedTopupQuota = '—'
  if (props.topupAmount) {
    formattedTopupQuota = formatPresetUsd(props.topupAmount)
    if (showUsdUnit) {
      formattedTopupQuota = `${formatPresetCredit(props.topupAmount)} · ${formatPresetUsd(props.topupAmount)}`
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Add credits')}
      description={t('Choose payment method, amount, then confirm')}
      contentClassName='sm:max-w-2xl'
      bodyClassName='space-y-6'
      footer={
        hasConfigurableTopup ? (
          <div className='flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div className='flex items-baseline gap-2 text-sm'>
              <span className='text-muted-foreground'>{t('Amount due')}</span>
              {props.calculating ? (
                <Skeleton className='h-5 w-20' />
              ) : (
                <span className='text-base font-semibold tabular-nums'>
                  {formatAmountDue(props.paymentAmount)}
                </span>
              )}
            </div>
            <Button
              className='sm:min-w-44'
              disabled={!canContinue}
              onClick={props.onContinueToPay}
            >
              {props.paymentLoading ? (
                <Loader2 className='mr-2 size-4 animate-spin' />
              ) : null}
              {t('Continue to pay')}
            </Button>
          </div>
        ) : null
      }
    >
      {!hasConfigurableTopup && !hasCreemProducts ? (
        <Alert>
          <AlertDescription>
            {t(
              'Online topup is not enabled. Please use redemption code or contact administrator.'
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {hasConfigurableTopup && (
        <>
          <section className='space-y-3'>
            <StepHeader step='01' title={t('Select top-up amount')} />
            {props.presetAmounts.length > 0 && (
              <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                {props.presetAmounts.map((preset) => {
                  const discount =
                    preset.discount ||
                    props.topupInfo?.discount?.[preset.value] ||
                    1.0
                  const selected = props.selectedPreset === preset.value
                  const creditLabel = formatPresetCredit(preset.value)
                  const usdLabel = formatPresetUsd(preset.value)
                  return (
                    <Button
                      key={preset.value}
                      variant='outline'
                      className={cn(
                        'flex min-h-14 flex-col items-stretch justify-center gap-0.5 rounded-lg px-3 py-2 whitespace-normal',
                        selected
                          ? 'border-foreground bg-foreground/5'
                          : 'border-muted'
                      )}
                      onClick={() => props.onSelectPreset(preset)}
                    >
                      <span className='flex items-center justify-between gap-1'>
                        <span className='text-sm font-semibold tabular-nums'>
                          {creditLabel}
                        </span>
                        {discount < 1.0 && (
                          <span className='text-xs font-medium text-green-600'>
                            {getDiscountLabel(discount)}
                          </span>
                        )}
                      </span>
                      {showUsdUnit ? (
                        <span className='text-muted-foreground text-left text-[11px] font-medium tabular-nums'>
                          {usdLabel}
                        </span>
                      ) : null}
                    </Button>
                  )
                })}
              </div>
            )}
            <div className='space-y-2'>
              <div className='flex items-center justify-between gap-2'>
                <Label
                  htmlFor='topup-amount'
                  className='text-muted-foreground text-xs font-medium tracking-wider uppercase'
                >
                  {t('Custom amount')}
                </Label>
                {showUsdUnit ? (
                  <div
                    className='bg-muted/50 flex gap-1 rounded-lg p-1'
                    role='tablist'
                    aria-label={t('Amount unit')}
                  >
                    {(
                      [
                        { unit: 'local' as const, label: currencyLabel },
                        { unit: 'usd' as const, label: 'USD' },
                      ] as const
                    ).map((option) => {
                      const active = customUnit === option.unit
                      return (
                        <button
                          key={option.unit}
                          type='button'
                          role='tab'
                          aria-selected={active}
                          className={cn(
                            'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
                            active
                              ? 'bg-background text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                          onClick={() => handleCustomUnitChange(option.unit)}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
              <InputGroup className='h-10'>
                <InputGroupInput
                  id='topup-amount'
                  type='number'
                  inputMode='decimal'
                  value={localAmount}
                  onChange={(e) => handleAmountChange(e.target.value)}
                  onFocus={() => {
                    customAmountFocusedRef.current = true
                  }}
                  onBlur={() => {
                    customAmountFocusedRef.current = false
                    setLocalAmount(
                      formatCustomDraft(
                        props.topupAmount,
                        showUsdUnit ? customUnit : 'usd'
                      )
                    )
                  }}
                  min={
                    showUsdUnit && customUnit === 'local'
                      ? (convertUsdToLocalAmount(effectiveMin) ?? effectiveMin)
                      : effectiveMin
                  }
                  placeholder={t('Minimum {{amount}}', {
                    amount:
                      showUsdUnit && customUnit === 'local'
                        ? formatCurrencyFromUSD(
                            effectiveMin,
                            LOCAL_AMOUNT_FORMAT
                          )
                        : formatUSDAmount(effectiveMin, USD_AMOUNT_FORMAT),
                  })}
                  className='h-10 text-base'
                />
                <InputGroupAddon align='inline-end'>
                  <InputGroupText>
                    {showUsdUnit && customUnit === 'local'
                      ? currencyLabel
                      : 'USD'}
                  </InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              {showUsdUnit && props.topupAmount > 0 ? (
                <p className='text-muted-foreground text-xs tabular-nums'>
                  {customUnit === 'local'
                    ? t('≈ {{amount}}', {
                        amount: formatPresetUsd(props.topupAmount),
                      })
                    : t('≈ {{amount}}', {
                        amount: formatPresetCredit(props.topupAmount),
                      })}
                </p>
              ) : null}
            </div>
          </section>

          <section className='space-y-3'>
            <StepHeader step='02' title={t('Payment method')} />
            {hasStandardMethods && (
              <div className='grid gap-2 sm:grid-cols-2'>
                {props.topupInfo?.pay_methods?.map((method) => {
                  const selected =
                    props.selectedPaymentMethod?.type === method.type
                  return (
                    <button
                      key={method.type}
                      type='button'
                      onClick={() => props.onPaymentMethodSelect(method)}
                      className={cn(
                        'flex min-h-14 flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
                        selected
                          ? 'border-foreground bg-foreground/5'
                          : 'hover:bg-muted/40'
                      )}
                    >
                      <span className='flex items-center gap-2 text-sm font-medium'>
                        {getPaymentIcon(
                          method.type,
                          'h-4 w-4',
                          method.icon,
                          t(method.name)
                        )}
                        {t(method.name)}
                      </span>
                      {method.min_topup ? (
                        <span className='text-muted-foreground text-[11px]'>
                          {t('Minimum top-up {{amount}}', {
                            amount: showUsdUnit
                              ? `${formatPresetCredit(method.min_topup)} (${formatPresetUsd(method.min_topup)})`
                              : formatPresetUsd(method.min_topup),
                          })}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}

            {!hasStandardMethods && !hasWaffoMethods && (
              <Alert>
                <AlertDescription>
                  {t(
                    'No payment methods available. Please contact administrator.'
                  )}
                </AlertDescription>
              </Alert>
            )}

            {enableWaffo && hasWaffoMethods && props.onWaffoMethodSelect && (
              <div className='grid grid-cols-2 gap-2'>
                {props.waffoPayMethods?.map((method, index) => {
                  const loadingKey = `waffo-${index}`
                  const methodKey = `${method.payMethodType ?? 'unknown'}-${method.payMethodName ?? method.name}`
                  const belowMin =
                    (props.topupInfo?.waffo_min_topup || 0) > props.topupAmount
                  return (
                    <Button
                      key={methodKey}
                      variant='outline'
                      onClick={() => props.onWaffoMethodSelect?.(method, index)}
                      disabled={belowMin || !!props.paymentLoading}
                      className='min-h-12 justify-start gap-2'
                    >
                      {props.paymentLoading === loadingKey ? (
                        <Loader2 className='size-4 animate-spin' />
                      ) : (
                        getPaymentIcon('waffo')
                      )}
                      <span className='truncate'>{method.name}</span>
                    </Button>
                  )
                })}
              </div>
            )}
          </section>

          <section className='space-y-3'>
            <StepHeader step='03' title={t('Confirm order')} />
            <div className='bg-muted/30 space-y-2.5 rounded-xl border p-4 text-sm'>
              <div className='flex justify-between gap-3'>
                <span className='text-muted-foreground'>
                  {t('Top-up quota')}
                </span>
                <span className='text-right font-semibold tabular-nums'>
                  {formattedTopupQuota}
                </span>
              </div>
              <div className='flex justify-between gap-3'>
                <span className='text-muted-foreground'>
                  {t('Payment method')}
                </span>
                <span className='truncate font-medium'>
                  {props.selectedPaymentMethod?.name
                    ? t(props.selectedPaymentMethod.name)
                    : t('Not selected')}
                </span>
              </div>
              <div className='flex justify-between gap-3'>
                <span className='text-muted-foreground'>
                  {t('Minimum top-up')}
                </span>
                <span className='text-right tabular-nums'>
                  {showUsdUnit
                    ? `${formatPresetCredit(effectiveMin)} · ${formatPresetUsd(effectiveMin)}`
                    : formatPresetUsd(effectiveMin)}
                </span>
              </div>
            </div>

            <label className='flex cursor-pointer items-start gap-2 text-xs leading-relaxed'>
              <Checkbox
                checked={termsAccepted}
                onCheckedChange={(v) => setTermsAccepted(v === true)}
                className='mt-0.5'
              />
              <span className='text-muted-foreground'>
                {t(
                  'I confirm and agree to the Terms of Service and Privacy Policy.'
                )}
              </span>
            </label>
          </section>
        </>
      )}

      {hasCreemProducts && props.onCreemProductSelect && (
        <section className='space-y-3 border-t pt-4'>
          <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
            {t('Creem Payment')}
          </Label>
          <CreemProductsSection
            products={props.creemProducts ?? []}
            onProductSelect={props.onCreemProductSelect}
          />
        </section>
      )}
    </Dialog>
  )
}
