import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { ArrowLeft, CheckCircle2, Loader2 } from '@/components/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { SegmentedControl } from '@/components/ui/segmented-control'
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
  BankQRPaymentData,
  BankQRQuote,
  CreemProduct,
  PaymentMethod,
  PresetAmount,
  TopupInfo,
  WaffoPayMethod,
} from '../../types'
import { CreemProductsSection } from '../creem-products-section'
import { CreemPurchaseSummary } from '../creem-purchase-summary'
import { DiscountSummary } from '../discount-summary'
import { PaymentReviewSummary } from '../payment-review-summary'
import {
  BankQRPaymentActions,
  BankQRPaymentDetails,
} from './bank-qr-payment-dialog'
import { TopUpProofForm } from './top-up-proof-dialog'

/**
 * Steps of the single top-up dialog. Each step replaces the dialog content
 * instead of stacking another modal on top of it.
 */
export type TopUpStep =
  | 'configure'
  | 'review'
  | 'creem-review'
  | 'bank-qr'
  | 'proof'

interface TopUpStepView {
  title: string
  description: string
  body: ReactNode
  footer: ReactNode
}

const PRESET_SKELETON_KEYS = ['one', 'two', 'three', 'four']

interface AddCreditsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  step: TopUpStep
  onStepChange: (step: TopUpStep) => void
  topupInfo: TopupInfo | null
  loading: boolean
  isError: boolean
  onRetry: () => void
  presetAmounts: PresetAmount[]
  selectedPreset: number | null
  onSelectPreset: (preset: PresetAmount) => void
  topupAmount: number
  onTopupAmountChange: (amount: number) => void
  paymentAmount: number
  quote: BankQRQuote | null
  couponCode: string
  onCouponCodeChange: (code: string) => void
  calculating: boolean
  selectedPaymentMethod?: PaymentMethod
  onPaymentMethodSelect: (method: PaymentMethod) => void
  onContinueToPay: () => void
  paymentLoading: string | null
  creemProducts?: CreemProduct[]
  onCreemProductSelect?: (product: CreemProduct) => void
  waffoPayMethods?: WaffoPayMethod[]
  onWaffoMethodSelect?: (method: WaffoPayMethod, index: number) => void
  /** Review step: creates the order with the provider (unchanged API calls). */
  onConfirmPayment: () => void
  processing: boolean
  discountRate: number
  selectedCreemProduct: CreemProduct | null
  onConfirmCreem: () => void
  creemProcessing: boolean
  /** Order created by the bank QR step; drives the QR and proof steps. */
  bankQRPayment: BankQRPaymentData | null
  /** A bank QR order was cancelled or had proof submitted. */
  onBankQROrderChanged: () => void
}

function StepHeader(props: { step: string; title: string }) {
  return (
    <div className='flex items-center gap-2.5'>
      <span className='bg-primary/10 text-primary text-2xs flex size-6 shrink-0 items-center justify-center rounded-full font-semibold tabular-nums'>
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
 * Top-up wizard in one dialog: amount and method → review → (bank QR) transfer
 * details → payment proof. Steps are owned by the billing page, which performs
 * the payment calls; this component only swaps the dialog content.
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
  const [couponDraft, setCouponDraft] = useState(props.couponCode)
  const isBankQR = props.selectedPaymentMethod?.type === 'bank_qr'
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

  // Vietnamese bank transfer (VietQR) is the primary rail: list it first.
  const sortedPayMethods = [...(props.topupInfo?.pay_methods ?? [])].sort(
    (a, b) => Number(isBankQRPayment(b.type)) - Number(isBankQRPayment(a.type))
  )

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
    !props.calculating &&
    props.paymentAmount > 0 &&
    (!isBankQR || (couponDraft === props.couponCode && !!props.quote)) &&
    !props.paymentLoading

  let formattedTopupQuota = '—'
  if (props.topupAmount) {
    formattedTopupQuota = formatPresetUsd(props.topupAmount)
    if (showUsdUnit) {
      formattedTopupQuota = `${formatPresetCredit(props.topupAmount)} · ${formatPresetUsd(props.topupAmount)}`
    }
  }

  const configureFooter = hasConfigurableTopup ? (
    <div className='flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
      <div className='flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm'>
        <span className='text-muted-foreground'>{t('Amount due')}</span>
        {props.calculating ? (
          <Skeleton className='h-5 w-20' />
        ) : (
          <span className='text-lg font-semibold tracking-tight tabular-nums'>
            {isBankQR && (couponDraft !== props.couponCode || !props.quote)
              ? '—'
              : formatAmountDue(props.paymentAmount)}
          </span>
        )}
      </div>
      <Button
        size='lg'
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

  let configureBody: ReactNode
  if (props.loading) {
    configureBody = (
      <div className='space-y-6' aria-busy='true'>
        <div className='space-y-3'>
          <Skeleton className='h-5 w-40' />
          <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
            {PRESET_SKELETON_KEYS.map((key) => (
              <Skeleton key={key} className='h-14 rounded-lg' />
            ))}
          </div>
          <Skeleton className='h-10 w-full rounded-lg' />
        </div>
        <div className='space-y-3'>
          <Skeleton className='h-5 w-32' />
          <div className='grid gap-2 sm:grid-cols-2'>
            <Skeleton className='h-14 rounded-lg' />
            <Skeleton className='h-14 rounded-lg' />
          </div>
        </div>
      </div>
    )
  } else if (props.isError) {
    configureBody = (
      <ErrorState
        title={t('Failed to load top-up options')}
        description={t('Check your connection and try again.')}
        onRetry={props.onRetry}
        className='min-h-60'
      />
    )
  } else {
    configureBody = (
      <>
        {isBankQR && (
          <section className='space-y-3'>
            <Label htmlFor='topup-coupon'>{t('Coupon code')}</Label>
            <div className='flex gap-2'>
              <Input
                id='topup-coupon'
                value={couponDraft}
                maxLength={64}
                onChange={(event) =>
                  setCouponDraft(event.target.value.toUpperCase().trim())
                }
              />
              <Button
                variant='outline'
                disabled={
                  props.calculating || !/^[A-Z0-9_-]*$/.test(couponDraft)
                }
                onClick={() => props.onCouponCodeChange(couponDraft)}
              >
                {t('Apply')}
              </Button>
            </div>
            <p className='text-muted-foreground text-xs'>
              {t(
                'The best discount applies unless your coupon allows stacking. Discounts apply to bank QR balance top-ups only.'
              )}
            </p>
            {couponDraft === props.couponCode && props.quote && (
              <DiscountSummary
                snapshot={props.quote}
                paid={props.quote.amount}
              />
            )}
            {couponDraft !== props.couponCode && (
              <p className='text-muted-foreground text-sm'>
                {t('Apply your code to refresh the quote.')}
              </p>
            )}
          </section>
        )}
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
                      <button
                        key={preset.value}
                        type='button'
                        aria-pressed={selected}
                        className={cn(
                          'bg-card relative flex min-h-16 min-w-0 flex-col items-start justify-center gap-0.5 rounded-xl px-3 py-2.5 text-left ring-1 transition-[background-color,box-shadow] duration-control',
                          'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
                          selected
                            ? 'bg-primary/5 ring-primary ring-2'
                            : 'ring-border hover:bg-muted/50'
                        )}
                        onClick={() => props.onSelectPreset(preset)}
                      >
                        <span
                          className='max-w-full truncate text-base font-semibold tabular-nums'
                          title={creditLabel}
                        >
                          {creditLabel}
                        </span>
                        <span className='flex max-w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5'>
                          {showUsdUnit ? (
                            <span className='text-muted-foreground text-2xs font-medium tabular-nums'>
                              {usdLabel}
                            </span>
                          ) : null}
                          {discount < 1.0 && (
                            <Badge
                              variant='success'
                              className='text-3xs h-4 px-1.5'
                            >
                              {getDiscountLabel(discount)}
                            </Badge>
                          )}
                        </span>
                        {selected && (
                          <CheckCircle2
                            weight='fill'
                            className='text-primary absolute top-2 right-2 size-4'
                            aria-hidden='true'
                          />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
              <div className='space-y-2'>
                <div className='flex items-center justify-between gap-2'>
                  <Label htmlFor='topup-amount'>{t('Custom amount')}</Label>
                  {showUsdUnit ? (
                    <SegmentedControl
                      size='sm'
                      aria-label={t('Amount unit')}
                      value={customUnit}
                      onValueChange={handleCustomUnitChange}
                      options={[
                        { value: 'local', label: currencyLabel },
                        { value: 'usd', label: 'USD' },
                      ]}
                    />
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
                        ? (convertUsdToLocalAmount(effectiveMin) ??
                          effectiveMin)
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
                  {sortedPayMethods.map((method) => {
                    const selected =
                      props.selectedPaymentMethod?.type === method.type
                    const isLocalRail = isBankQRPayment(method.type)
                    return (
                      <button
                        key={method.type}
                        type='button'
                        aria-pressed={selected}
                        onClick={() => props.onPaymentMethodSelect(method)}
                        className={cn(
                          'bg-card relative flex min-h-16 min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition-[background-color,box-shadow] duration-control',
                          'focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
                          selected
                            ? 'bg-primary/5 ring-primary ring-2'
                            : 'ring-border hover:bg-muted/50',
                          isLocalRail && 'sm:col-span-2'
                        )}
                      >
                        <span className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg [&_img]:size-5 [&_svg]:size-5'>
                          {getPaymentIcon(
                            method.type,
                            'h-5 w-5',
                            method.icon,
                            t(method.name)
                          )}
                        </span>
                        <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
                          <span className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5'>
                            <span className='min-w-0 truncate text-sm font-medium'>
                              {t(method.name)}
                            </span>
                            {isLocalRail && (
                              <Badge variant='success' className='shrink-0'>
                                {t('Recommended in Vietnam')}
                              </Badge>
                            )}
                          </span>
                          {isLocalRail && (
                            <span className='text-muted-foreground text-2xs'>
                              {t(
                                'VietQR · instant transfer from any Vietnamese bank'
                              )}
                            </span>
                          )}
                          {method.min_topup ? (
                            <span className='text-muted-foreground text-2xs'>
                              {t('Minimum top-up {{amount}}', {
                                amount: showUsdUnit
                                  ? `${formatPresetCredit(method.min_topup)} (${formatPresetUsd(method.min_topup)})`
                                  : formatPresetUsd(method.min_topup),
                              })}
                            </span>
                          ) : null}
                        </span>
                        {selected && (
                          <CheckCircle2
                            weight='fill'
                            className='text-primary size-4 shrink-0'
                            aria-hidden='true'
                          />
                        )}
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
                      (props.topupInfo?.waffo_min_topup || 0) >
                      props.topupAmount
                    return (
                      <Button
                        key={methodKey}
                        variant='outline'
                        onClick={() =>
                          props.onWaffoMethodSelect?.(method, index)
                        }
                        disabled={belowMin || !!props.paymentLoading}
                        className='h-auto min-h-12 justify-start gap-2 rounded-xl'
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
              <div className='bg-surface-subtle ring-border space-y-2.5 rounded-xl p-4 text-sm ring-1'>
                <div className='flex justify-between gap-3'>
                  <span className='text-muted-foreground'>
                    {t('Top-up quota')}
                  </span>
                  <span className='text-right font-semibold tabular-nums'>
                    {formattedTopupQuota}
                  </span>
                </div>
                <div className='flex justify-between gap-3'>
                  <span className='text-muted-foreground shrink-0'>
                    {t('Payment method')}
                  </span>
                  <span className='min-w-0 truncate text-right font-medium'>
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
            <Label className='text-sm font-semibold'>
              {t('Creem Payment')}
            </Label>
            <CreemProductsSection
              products={props.creemProducts ?? []}
              onProductSelect={props.onCreemProductSelect}
            />
          </section>
        )}
      </>
    )
  }

  const backButton = (
    <Button
      variant='outline'
      onClick={() => props.onStepChange('configure')}
      disabled={props.processing || props.creemProcessing}
    >
      <ArrowLeft className='mr-2 size-4' aria-hidden='true' />
      {t('Back')}
    </Button>
  )

  let view: TopUpStepView = {
    title: t('Add credits'),
    description: t('Choose payment method, amount, then confirm'),
    body: configureBody,
    footer: props.loading || props.isError ? null : configureFooter,
  }

  if (props.step === 'review') {
    view = {
      title: t('Confirm Payment'),
      description: t('Review your payment details'),
      body: (
        <PaymentReviewSummary
          quote={props.quote}
          topupAmount={props.topupAmount}
          paymentAmount={props.paymentAmount}
          paymentMethod={props.selectedPaymentMethod}
          calculating={props.calculating}
          discountRate={props.discountRate}
        />
      ),
      footer: (
        <div className='grid w-full grid-cols-2 gap-2 sm:flex sm:justify-end'>
          {backButton}
          <Button
            onClick={props.onConfirmPayment}
            disabled={
              props.processing ||
              props.calculating ||
              (isBankQR && !props.quote)
            }
          >
            {props.processing && (
              <Loader2 className='mr-2 size-4 animate-spin' />
            )}
            {t('Confirm Payment')}
          </Button>
        </div>
      ),
    }
  } else if (props.step === 'creem-review' && props.selectedCreemProduct) {
    view = {
      title: t('Confirm Creem Purchase'),
      description: t('Review your purchase details before proceeding.'),
      body: <CreemPurchaseSummary product={props.selectedCreemProduct} />,
      footer: (
        <div className='grid w-full grid-cols-2 gap-2 sm:flex sm:justify-end'>
          {backButton}
          <Button
            onClick={props.onConfirmCreem}
            disabled={props.creemProcessing}
          >
            {props.creemProcessing && (
              <Loader2 className='mr-2 size-4 animate-spin' />
            )}
            {t('Confirm Payment')}
          </Button>
        </div>
      ),
    }
  } else if (props.step === 'bank-qr' && props.bankQRPayment) {
    view = {
      title: t('Pay by bank transfer'),
      description: t(
        'Scan the VietQR code or copy the bank details to complete your transfer.'
      ),
      body: <BankQRPaymentDetails payment={props.bankQRPayment} />,
      footer: (
        <BankQRPaymentActions
          payment={props.bankQRPayment}
          onClose={() => props.onOpenChange(false)}
          onCancelled={props.onBankQROrderChanged}
          onPaid={() => props.onStepChange('proof')}
        />
      ),
    }
  } else if (props.step === 'proof' && props.bankQRPayment) {
    view = {
      title: t('Submit payment proof'),
      description: t(
        'Provide your bank transaction number or a payment screenshot.'
      ),
      body: (
        <TopUpProofForm
          active
          tradeNo={props.bankQRPayment.trade_no}
          expiresAt={props.bankQRPayment.expires_at}
          onSubmitted={props.onBankQROrderChanged}
          onClose={() => props.onOpenChange(false)}
        />
      ),
      footer: null,
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        // While a payment or order request is in flight the dialog stays
        // put, so a bank-QR order created by that request is always shown.
        if (!open && (props.processing || props.creemProcessing)) return
        props.onOpenChange(open)
      }}
      title={view.title}
      description={view.description}
      contentClassName={
        props.step === 'configure' ? 'sm:max-w-2xl' : 'sm:max-w-xl'
      }
      bodyClassName='space-y-6'
      footer={view.footer}
    >
      {view.body}
    </Dialog>
  )
}
