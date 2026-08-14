import i18next from 'i18next'
import { useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'

import {
  calculateAmount,
  calculateStripeAmount,
  calculateWaffoPancakeAmount,
  calculateBankQRAmount,
  requestPayment,
  requestStripePayment,
  isApiSuccess,
} from '../api'
import {
  isBankQRPayment,
  isStripePayment,
  isWaffoPancakePayment,
  submitPaymentForm,
} from '../lib'

// ============================================================================
// Payment Hook
// ============================================================================

export function usePayment() {
  const [amount, setAmount] = useState<number>(0)
  const [calculating, setCalculating] = useState(false)
  const [processing, setProcessing] = useState(false)
  const calculationIdRef = useRef(0)

  // Calculate payment amount
  const calculatePaymentAmount = useCallback(
    async (topupAmount: number, paymentType: string) => {
      const calculationId = ++calculationIdRef.current
      try {
        setCalculating(true)

        const isStripe = isStripePayment(paymentType)
        const isBankQR = isBankQRPayment(paymentType)
        const isPancake = isWaffoPancakePayment(paymentType)
        if (isBankQR) {
          const response = await calculateBankQRAmount({ amount: topupAmount })
          if (calculationId !== calculationIdRef.current) return null
          if (isApiSuccess(response) && response.data) {
            setAmount(response.data.amount)
            return response.data.amount
          }
          toast.error(
            response.message || i18next.t('Failed to calculate amount')
          )
          setAmount(0)
          return null
        }

        let calculate = calculateAmount
        if (isStripe) {
          calculate = calculateStripeAmount
        } else if (isPancake) {
          calculate = calculateWaffoPancakeAmount
        }
        const response = await calculate({ amount: topupAmount })
        if (calculationId !== calculationIdRef.current) return null

        if (isApiSuccess(response) && response.data) {
          const calculatedAmount = Number.parseFloat(response.data)
          setAmount(calculatedAmount)
          return calculatedAmount
        }

        // Don't show error for calculation, just set to 0
        setAmount(0)
        return null
      } catch {
        if (calculationId === calculationIdRef.current) setAmount(0)
        return null
      } finally {
        if (calculationId === calculationIdRef.current) setCalculating(false)
      }
    },
    []
  )

  // Process payment
  const processPayment = useCallback(
    async (topupAmount: number, paymentType: string) => {
      try {
        setProcessing(true)

        const isStripe = isStripePayment(paymentType)
        const amount = Math.round(topupAmount * 100) / 100

        const response = isStripe
          ? await requestStripePayment({
              amount,
              payment_method: 'stripe',
            })
          : await requestPayment({
              amount,
              payment_method: paymentType,
            })

        if (!isApiSuccess(response)) {
          toast.error(response.message || i18next.t('Payment request failed'))
          return false
        }

        // Handle Stripe payment
        if (isStripe && response.data?.pay_link) {
          window.open(response.data.pay_link as string, '_blank')
          toast.success(i18next.t('Redirecting to payment page...'))
          return true
        }

        // Handle non-Stripe payment
        if (!isStripe && response.data) {
          const url = (response as unknown as { url?: string }).url
          if (url) {
            submitPaymentForm(url, response.data)
            toast.success(i18next.t('Redirecting to payment page...'))
            return true
          }
        }

        return false
      } catch {
        toast.error(i18next.t('Payment request failed'))
        return false
      } finally {
        setProcessing(false)
      }
    },
    []
  )

  return {
    amount,
    calculating,
    processing,
    calculatePaymentAmount,
    processPayment,
    setAmount,
  }
}
