import i18next from 'i18next'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { isApiSuccess, requestBankQRPayment } from '../api'
import type { BankQRPaymentData } from '../types'

export function useBankQRPayment() {
  const [processing, setProcessing] = useState(false)

  const processBankQRPayment = useCallback(async (amount: number) => {
    try {
      setProcessing(true)
      const response = await requestBankQRPayment({
        amount: Math.round(amount * 100) / 100,
      })
      if (!isApiSuccess(response) || !response.data) {
        toast.error(response.message || i18next.t('Payment request failed'))
        return null
      }
      return response.data as BankQRPaymentData
    } catch {
      toast.error(i18next.t('Payment request failed'))
      return null
    } finally {
      setProcessing(false)
    }
  }, [])

  return { processing, processBankQRPayment }
}
