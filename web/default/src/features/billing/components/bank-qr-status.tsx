import { useTranslation } from 'react-i18next'

import type { BankQRStatus } from '../hooks/use-bank-qr-status'

export function BankQRStatusMessage(props: { confirmation: BankQRStatus }) {
  const { t } = useTranslation()
  const confirmation = props.confirmation
  let message = ''
  if (confirmation.status === 'success') {
    message = t('Payment received. Your purchase is complete.')
  } else if (confirmation.status === 'expired') {
    message = t('Payment expired. Do not transfer funds.')
  } else if (confirmation.status === 'cancelled') {
    message = t('Payment cancelled. Do not transfer funds.')
  } else if (confirmation.error) {
    message = t(
      'Unable to check payment status. Retrying automatically; do not pay again.'
    )
  } else if (confirmation.checking) {
    message = t('Checking payment status...')
  } else if (confirmation.automatic) {
    message = t(
      'Waiting for bank confirmation. SePay automatically confirms transfers with the exact amount and transfer content.'
    )
  }
  if (!message) return null

  return (
    <div
      role='status'
      aria-live='polite'
      className='bg-muted space-y-2 rounded-lg p-4 text-sm'
    >
      <p className='font-medium'>{message}</p>
      {confirmation.automatic && !confirmation.terminal && (
        <p className='text-muted-foreground'>
          {t(
            'If confirmation is delayed or the transfer details differ, submit payment proof for review. Submitting proof does not confirm receipt.'
          )}
        </p>
      )}
    </div>
  )
}
