import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import {
  formatCurrencyFromUSD,
  isCurrencyDisplayEnabled,
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

/**
 * Top-up wizard: amount → payment method → confirm. The final confirmation
 * happens in the layered PaymentConfirmDialog owned by the billing page.
 */
export function AddCreditsDialog(props: AddCreditsDialogProps) {
  const { t, i18n } = useTranslation()
  const [localAmount, setLocalAmount] = useState(props.topupAmount.toString())
  const [termsAccepted, setTermsAccepted] = useState(false)

  useEffect(() => {
    setLocalAmount(props.topupAmount.toString())
  }, [props.topupAmount])

  const handleAmountChange = (value: string) => {
    setLocalAmount(value)
    const parsed = Number.parseInt(value) || 0
    if (parsed >= 0) props.onTopupAmountChange(parsed)
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
                  const creditLabel = isCurrencyDisplayEnabled()
                    ? formatCurrencyFromUSD(preset.value, { abbreviate: false })
                    : formatNumber(preset.value)
                  return (
                    <Button
                      key={preset.value}
                      variant='outline'
                      className={cn(
                        'flex min-h-11 items-center justify-between gap-1 rounded-lg px-3 whitespace-normal',
                        selected
                          ? 'border-foreground bg-foreground/5'
                          : 'border-muted'
                      )}
                      onClick={() => props.onSelectPreset(preset)}
                    >
                      <span className='text-sm font-semibold tabular-nums'>
                        {creditLabel}
                      </span>
                      {discount < 1.0 && (
                        <span className='text-xs font-medium text-green-600'>
                          {getDiscountLabel(discount)}
                        </span>
                      )}
                    </Button>
                  )
                })}
              </div>
            )}
            <div className='space-y-2'>
              <Label
                htmlFor='topup-amount'
                className='text-muted-foreground text-xs font-medium tracking-wider uppercase'
              >
                {t('Custom amount')}
              </Label>
              <Input
                id='topup-amount'
                type='number'
                value={localAmount}
                onChange={(e) => handleAmountChange(e.target.value)}
                min={effectiveMin}
                placeholder={t('Minimum {{amount}}', { amount: effectiveMin })}
                className='h-10 text-base'
              />
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
                            amount: method.min_topup,
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
                      onClick={() =>
                        props.onWaffoMethodSelect?.(method, index)
                      }
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
                <span className='font-semibold tabular-nums'>
                  {props.topupAmount || '—'}
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
                <span className='tabular-nums'>{effectiveMin}</span>
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
