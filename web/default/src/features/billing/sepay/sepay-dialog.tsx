import { QRCodeSVG } from 'qrcode.react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

import { OrderExpiry } from '../promotions/order-expiry'
import { useOrderExpired } from '../promotions/use-order-expired'
import { useSePay } from './use-sepay'

export function SePayDialog(props: {
  tradeNo: string | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { invoice, cancel } = useSePay(props.tradeNo, !!props.tradeNo)
  const payment = invoice.data
  const expired = useOrderExpired(payment?.expires_at)
  const qr = useRef<HTMLDivElement>(null)
  let message = t('Checking payment status...')
  if (payment?.status === 'pending') {
    message = t('Waiting for SePay confirmation')
  }
  if (payment?.status === 'success') {
    message = t('Payment received. Your purchase is complete.')
  }
  if (payment?.status === 'cancelled') {
    message = t('Payment cancelled. Do not transfer funds.')
  }
  if (
    payment?.status === 'expired' ||
    (expired && payment?.status === 'pending')
  ) {
    message = t('Payment expired. Do not transfer funds.')
  }
  if (invoice.isError) {
    message = t(
      'Unable to check payment status. Retrying automatically; do not pay again.'
    )
  }

  const download = () => {
    const svg = qr.current?.querySelector('svg')
    if (!svg) return
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: 'image/svg+xml',
      })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `sepay-${payment?.trade_no}.svg`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog
      open={!!props.tradeNo}
      onOpenChange={(open) => !open && props.onClose()}
      title='SePay'
      contentClassName='sm:max-w-xl'
      footer={
        <>
          {payment?.status === 'pending' && (
            <Button
              variant='outline'
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {t('Cancel order')}
            </Button>
          )}
          <Button onClick={props.onClose}>{t('Close')}</Button>
        </>
      }
    >
      <div className='space-y-4'>
        <p role='status' className='bg-muted rounded-lg p-3 text-sm'>
          {message}
        </p>
        {cancel.isError && <p role='alert'>{t('Payment request failed')}</p>}
        {invoice.isError && (
          <Button variant='outline' onClick={() => void invoice.refetch()}>
            {t('Retry')}
          </Button>
        )}
        {payment?.status === 'pending' && (
          <>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Transfer the exact amount and content. If confirmation is delayed or details differ, contact support for reconciliation. Do not pay again.'
              )}
            </p>
            <OrderExpiry expiresAt={payment.expires_at} />
            {!expired && (
              <div className='flex flex-col items-center gap-2'>
                <div ref={qr} className='rounded-xl bg-white p-3'>
                  <QRCodeSVG value={payment.payload} size={192} includeMargin />
                </div>
                <Button variant='outline' onClick={download}>
                  {t('Download QR code')}
                </Button>
              </div>
            )}
          </>
        )}
        {payment && (
          <dl className='space-y-3'>
            {[
              [
                t('Exact transfer amount'),
                `${payment.amount.toLocaleString()} VND`,
                String(payment.amount),
              ],
              [t('Bank'), payment.bank_name],
              [t('Account number'), payment.account_number],
              [t('Account holder'), payment.account_name],
              [t('Transfer content'), payment.transfer_content],
              [t('Order number'), payment.trade_no],
            ].map(([label, value, copy]) => (
              <div
                key={label}
                className='flex items-center justify-between gap-2 border-b pb-2'
              >
                <div>
                  <dt className='text-muted-foreground text-xs'>{label}</dt>
                  <dd className='text-sm font-medium break-all'>{value}</dd>
                </div>
                <CopyButton value={copy ?? value} aria-label={t('Copy')} />
              </div>
            ))}
          </dl>
        )}
      </div>
    </Dialog>
  )
}
