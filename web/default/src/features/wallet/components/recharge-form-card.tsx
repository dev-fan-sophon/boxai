/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Gift, ExternalLink, Loader2, Receipt, WalletCards } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  formatCurrency,
  getDiscountLabel,
  getPaymentIcon,
  getMinTopupAmount,
  calculatePresetPricing,
} from '../lib'
import type {
  PaymentMethod,
  PresetAmount,
  TopupInfo,
  CreemProduct,
  WaffoPayMethod,
} from '../types'
import { CreemProductsSection } from './creem-products-section'

interface RechargeFormCardProps {
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
  redemptionCode: string
  onRedemptionCodeChange: (code: string) => void
  onRedeem: () => void
  redeeming: boolean
  topupLink?: string
  loading?: boolean
  priceRatio?: number
  usdExchangeRate?: number
  onOpenBilling?: () => void
  creemProducts?: CreemProduct[]
  enableCreemTopup?: boolean
  onCreemProductSelect?: (product: CreemProduct) => void
  enableWaffoTopup?: boolean
  waffoPayMethods?: WaffoPayMethod[]
  waffoMinTopup?: number
  onWaffoMethodSelect?: (method: WaffoPayMethod, index: number) => void
  enableWaffoPancakeTopup?: boolean
}

function StepHeader(props: { step: string; title: string }) {
  return (
    <div className='flex items-center gap-2.5'>
      <span className='bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold'>
        {props.step}
      </span>
      <h3 className='text-sm font-semibold'>{props.title}</h3>
    </div>
  )
}

/**
 * Apilio-style top-up center: 01 payment method → 02 amount → 03 confirm.
 * All amounts/methods come from real topupInfo APIs — no mock presets.
 */
export function RechargeFormCard({
  topupInfo,
  presetAmounts,
  selectedPreset,
  onSelectPreset,
  topupAmount,
  onTopupAmountChange,
  paymentAmount,
  calculating,
  selectedPaymentMethod,
  onPaymentMethodSelect,
  onContinueToPay,
  paymentLoading,
  redemptionCode,
  onRedemptionCodeChange,
  onRedeem,
  redeeming,
  topupLink,
  loading,
  priceRatio = 1,
  usdExchangeRate = 1,
  onOpenBilling,
  creemProducts,
  enableCreemTopup,
  onCreemProductSelect,
  enableWaffoTopup,
  waffoPayMethods,
  waffoMinTopup,
  onWaffoMethodSelect,
  enableWaffoPancakeTopup,
}: RechargeFormCardProps) {
  const { t } = useTranslation()
  const [localAmount, setLocalAmount] = useState(topupAmount.toString())
  const [termsAccepted, setTermsAccepted] = useState(false)

  useEffect(() => {
    setLocalAmount(topupAmount.toString())
  }, [topupAmount])

  const handleAmountChange = (value: string) => {
    setLocalAmount(value)
    const numValue = Number.parseInt(value) || 0
    if (numValue >= 0) {
      onTopupAmountChange(numValue)
    }
  }

  const hasConfigurableTopup =
    topupInfo?.enable_online_topup ||
    topupInfo?.enable_stripe_topup ||
    topupInfo?.enable_bank_qr_topup ||
    enableWaffoTopup ||
    enableWaffoPancakeTopup
  const hasAnyTopup = hasConfigurableTopup || enableCreemTopup
  const hasStandardPaymentMethods =
    Array.isArray(topupInfo?.pay_methods) && topupInfo.pay_methods.length > 0
  const hasWaffoPaymentMethods =
    Array.isArray(waffoPayMethods) && waffoPayMethods.length > 0
  const minTopup = getMinTopupAmount(topupInfo)
  const redemptionEnabled = topupInfo?.enable_redemption !== false
  const methodMin = selectedPaymentMethod?.min_topup || 0
  const effectiveMin = Math.max(minTopup, methodMin)
  const canContinue =
    Boolean(selectedPaymentMethod) &&
    topupAmount >= effectiveMin &&
    termsAccepted &&
    !paymentLoading

  if (loading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <CardHeader className='border-b p-3 !pb-3 sm:p-5 sm:!pb-5'>
          <Skeleton className='h-6 w-32' />
          <Skeleton className='mt-2 h-4 w-48' />
        </CardHeader>
        <CardContent className='space-y-4 p-3 sm:space-y-6 sm:p-5'>
          <Skeleton className='h-24 w-full' />
          <Skeleton className='h-32 w-full' />
          <Skeleton className='h-40 w-full' />
        </CardContent>
      </Card>
    )
  }

  return (
    <TitledCard
      title={t('Top-up Center')}
      description={t('Choose payment method, amount, then confirm')}
      icon={<WalletCards className='h-4 w-4' />}
      iconTone='success'
      disableHoverEffect
      action={
        onOpenBilling ? (
          <Button
            variant='outline'
            size='sm'
            onClick={onOpenBilling}
            className='w-full gap-2 sm:w-auto'
          >
            <Receipt className='h-4 w-4' />
            {t('Order History')}
          </Button>
        ) : null
      }
      contentClassName='space-y-6 sm:space-y-8'
    >
      {hasAnyTopup ? (
        <div className='space-y-6 sm:space-y-8'>
          {hasConfigurableTopup && (
            <>
              {/* 01 Payment method */}
              <section className='space-y-3'>
                <StepHeader step='01' title={t('Payment method')} />
                {hasStandardPaymentMethods ? (
                  <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
                    {topupInfo?.pay_methods?.map((method) => {
                      const selected =
                        selectedPaymentMethod?.type === method.type
                      const minHint = method.min_topup
                        ? t('Minimum top-up {{amount}}', {
                            amount: method.min_topup,
                          })
                        : null
                      return (
                        <button
                          key={method.type}
                          type='button'
                          onClick={() => onPaymentMethodSelect(method)}
                          className={cn(
                            'flex min-h-16 flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
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
                          {minHint && (
                            <span className='text-muted-foreground text-[11px]'>
                              {minHint}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
                {!hasStandardPaymentMethods && !hasWaffoPaymentMethods && (
                  <Alert>
                    <AlertDescription>
                      {t(
                        'No payment methods available. Please contact administrator.'
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                {enableWaffoTopup &&
                  hasWaffoPaymentMethods &&
                  onWaffoMethodSelect && (
                    <div className='grid grid-cols-2 gap-2 lg:grid-cols-3'>
                      {waffoPayMethods?.map((method, index) => {
                        const loadingKey = `waffo-${index}`
                        const methodKey = `${method.payMethodType ?? 'unknown'}-${method.payMethodName ?? method.name}`
                        const waffoMin = waffoMinTopup || 0
                        const belowMin = waffoMin > topupAmount
                        return (
                          <Button
                            key={methodKey}
                            variant='outline'
                            onClick={() => onWaffoMethodSelect(method, index)}
                            disabled={belowMin || !!paymentLoading}
                            className='min-h-14 justify-start gap-2'
                          >
                            {paymentLoading === loadingKey ? (
                              <Loader2 className='h-4 w-4 animate-spin' />
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

              {/* 02 Amount */}
              <section className='space-y-3'>
                <StepHeader step='02' title={t('Select top-up amount')} />
                {presetAmounts.length > 0 && (
                  <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4'>
                    {presetAmounts.map((preset) => {
                      const discount =
                        preset.discount ||
                        topupInfo?.discount?.[preset.value] ||
                        1.0
                      const {
                        displayValue,
                        actualPrice,
                        savedAmount,
                        hasDiscount,
                      } = calculatePresetPricing(
                        preset.value,
                        priceRatio,
                        discount,
                        usdExchangeRate
                      )
                      const selected = selectedPreset === preset.value
                      return (
                        <Button
                          key={preset.value}
                          variant='outline'
                          className={cn(
                            'flex min-h-14 flex-col items-start rounded-lg px-3 py-2.5 text-left whitespace-normal',
                            selected
                              ? 'border-foreground bg-foreground/5'
                              : 'border-muted'
                          )}
                          onClick={() => onSelectPreset(preset)}
                        >
                          <div className='flex w-full items-center justify-between gap-1'>
                            <span className='text-base font-semibold tabular-nums'>
                              {formatNumber(displayValue)}
                            </span>
                            {hasDiscount && (
                              <span className='text-xs font-medium text-green-600'>
                                {getDiscountLabel(discount)}
                              </span>
                            )}
                          </div>
                          <span className='text-muted-foreground mt-1 text-[11px]'>
                            {formatCurrency(actualPrice)}
                            {hasDiscount && savedAmount > 0
                              ? ` · −${formatCurrency(savedAmount)}`
                              : ''}
                          </span>
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
                    placeholder={t('Minimum {{amount}}', {
                      amount: effectiveMin,
                    })}
                    className='h-10 text-base'
                  />
                </div>
              </section>

              {/* 03 Confirm */}
              <section className='space-y-3'>
                <StepHeader step='03' title={t('Confirm order')} />
                <div className='bg-muted/30 space-y-2.5 rounded-xl border p-4'>
                  <div className='flex justify-between gap-3 text-sm'>
                    <span className='text-muted-foreground'>
                      {t('Top-up quota')}
                    </span>
                    <span className='font-semibold tabular-nums'>
                      {topupAmount || '—'}
                    </span>
                  </div>
                  <div className='flex justify-between gap-3 text-sm'>
                    <span className='text-muted-foreground'>
                      {t('Payment method')}
                    </span>
                    <span className='truncate font-medium'>
                      {selectedPaymentMethod?.name
                        ? t(selectedPaymentMethod.name)
                        : t('Not selected')}
                    </span>
                  </div>
                  <div className='flex justify-between gap-3 text-sm'>
                    <span className='text-muted-foreground'>
                      {t('Minimum top-up')}
                    </span>
                    <span className='tabular-nums'>{effectiveMin}</span>
                  </div>
                  <div className='flex justify-between gap-3 border-t pt-2.5 text-sm'>
                    <span className='text-muted-foreground'>
                      {t('Amount due')}
                    </span>
                    {calculating ? (
                      <Skeleton className='h-5 w-16' />
                    ) : (
                      <span className='text-base font-semibold tabular-nums'>
                        {formatCurrency(paymentAmount)}
                      </span>
                    )}
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

                <Button
                  className='h-10 w-full sm:w-auto sm:min-w-48'
                  disabled={!canContinue}
                  onClick={onContinueToPay}
                >
                  {paymentLoading ? (
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  ) : null}
                  {t('Continue to pay')}
                </Button>
              </section>
            </>
          )}
        </div>
      ) : (
        <Alert>
          <AlertDescription>
            {t(
              'Online topup is not enabled. Please use redemption code or contact administrator.'
            )}
          </AlertDescription>
        </Alert>
      )}

      {enableCreemTopup &&
        Array.isArray(creemProducts) &&
        creemProducts.length > 0 &&
        onCreemProductSelect && (
          <div className='space-y-2.5 border-t pt-4 sm:space-y-3 sm:pt-6'>
            <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
              {t('Creem Payment')}
            </Label>
            <CreemProductsSection
              products={creemProducts}
              onProductSelect={onCreemProductSelect}
            />
          </div>
        )}

      {redemptionEnabled ? (
        <div className='space-y-2.5 border-t pt-4 sm:space-y-3 sm:pt-6'>
          <div className='flex items-center gap-2'>
            <IconBadge tone='warning' size='xs'>
              <Gift />
            </IconBadge>
            <Label
              htmlFor='redemption-code'
              className='text-muted-foreground text-xs font-medium tracking-wider uppercase'
            >
              {t('Have a Code?')}
            </Label>
          </div>
          <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-2'>
            <Input
              id='redemption-code'
              value={redemptionCode}
              onChange={(e) => onRedemptionCodeChange(e.target.value)}
              placeholder={t('Enter your redemption code')}
              className='h-9 min-w-0'
            />
            <Button
              onClick={onRedeem}
              disabled={redeeming}
              variant='outline'
              className='h-9 px-4'
            >
              {redeeming && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              {t('Redeem')}
            </Button>
          </div>
          {topupLink && (
            <p className='text-muted-foreground text-xs'>
              {t('Need a redemption code?')}{' '}
              <a
                href={topupLink}
                target='_blank'
                rel='noopener noreferrer'
                className='inline-flex items-center gap-1 underline-offset-4 hover:underline'
              >
                {t('Get one here')}
                <ExternalLink className='h-3 w-3' />
              </a>
            </p>
          )}
        </div>
      ) : (
        <Alert className='border-t'>
          <AlertDescription>
            {t(
              'Redemption codes are disabled until the administrator confirms compliance terms.'
            )}
          </AlertDescription>
        </Alert>
      )}
    </TitledCard>
  )
}
