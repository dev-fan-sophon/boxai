import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import {
  formatLocalCurrencyAmount,
  formatUSDAmount,
  getCurrencyDisplay,
  isNonUsdCurrencyDisplay,
} from '@/lib/currency'

import { DEFAULT_DISCOUNT_RATE } from '../constants'
import { formatCurrency, getPaymentIcon, isBankQRPayment } from '../lib'
import type { PaymentMethod, BankQRQuote } from '../types'
import { DiscountSummary } from './discount-summary'

interface PaymentReviewSummaryProps {
  quote?: BankQRQuote | null
  topupAmount: number
  paymentAmount: number
  paymentMethod: PaymentMethod | undefined
  calculating: boolean
  discountRate?: number
}

/**
 * Final order review shown as the second step of the top-up dialog, with the
 * server-calculated amount due for the selected payment method.
 */
export function PaymentReviewSummary(props: PaymentReviewSummaryProps) {
  const { t, i18n } = useTranslation()
  const paymentMethod = props.paymentMethod
  const topupAmount = props.topupAmount
  const paymentAmount = props.paymentAmount
  const discountRate = props.discountRate ?? DEFAULT_DISCOUNT_RATE
  const isBankQR = paymentMethod ? isBankQRPayment(paymentMethod.type) : false
  const { meta } = getCurrencyDisplay()
  const creditedUsd =
    meta.kind === 'currency' ? topupAmount / meta.exchangeRate : topupAmount
  const formatPaymentAmount = (amount: number) =>
    isBankQR
      ? new Intl.NumberFormat(toIntlLocale(i18n.language), {
          style: 'currency',
          currency: 'VND',
          maximumFractionDigits: 0,
        }).format(amount)
      : formatCurrency(amount)
  const hasDiscount = discountRate > 0 && discountRate < 1 && paymentAmount > 0
  const originalAmount = hasDiscount ? paymentAmount / discountRate : 0
  const discountAmount = hasDiscount ? originalAmount - paymentAmount : 0

  return (
    <div className='space-y-3 sm:space-y-4'>
      {isBankQR && props.quote ? (
        <DiscountSummary snapshot={props.quote} paid={props.quote.amount} />
      ) : (
        <>
          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground text-sm'>
              {t('Topup Amount')}
            </span>
            <span className='text-right text-lg font-semibold'>
              {isNonUsdCurrencyDisplay() ? (
                <span className='flex flex-col items-end leading-tight'>
                  <span>
                    {formatLocalCurrencyAmount(topupAmount, {
                      digitsLarge: 0,
                      digitsSmall: 0,
                      abbreviate: false,
                    })}
                  </span>
                  <span className='text-muted-foreground text-xs font-medium tabular-nums'>
                    {formatUSDAmount(creditedUsd, {
                      digitsLarge: 2,
                      digitsSmall: 2,
                      abbreviate: false,
                    })}
                  </span>
                </span>
              ) : (
                formatUSDAmount(topupAmount, {
                  digitsLarge: 2,
                  digitsSmall: 2,
                  abbreviate: false,
                })
              )}
            </span>
          </div>

          <div className='flex items-center justify-between'>
            <span className='text-muted-foreground text-sm'>
              {t('You Pay')}
            </span>
            {props.calculating ? (
              <Skeleton className='h-6 w-24' />
            ) : (
              <div className='flex items-baseline gap-2'>
                <span className='text-2xl font-semibold'>
                  {formatPaymentAmount(paymentAmount)}
                </span>
                {hasDiscount && (
                  <span className='text-muted-foreground text-sm line-through'>
                    {formatPaymentAmount(originalAmount)}
                  </span>
                )}
              </div>
            )}
          </div>

          {hasDiscount && !props.calculating && (
            <div className='bg-muted/50 rounded-lg p-3'>
              <div className='flex items-center justify-between text-sm'>
                <span className='text-muted-foreground'>{t('You save')}</span>
                <span className='text-success font-semibold'>
                  {formatPaymentAmount(discountAmount)}
                </span>
              </div>
            </div>
          )}
        </>
      )}
      <div className='border-t pt-4'>
        <div className='flex items-center justify-between'>
          <span className='text-muted-foreground text-sm'>
            {t('Payment Method')}
          </span>
          <div className='flex items-center gap-2'>
            {getPaymentIcon(
              paymentMethod?.type,
              'h-4 w-4',
              paymentMethod?.icon,
              paymentMethod?.name ? t(paymentMethod.name) : undefined
            )}
            <span className='font-medium'>
              {paymentMethod?.name ? t(paymentMethod.name) : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
