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
import { AlertTriangle, Download, Landmark } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'

import type { BankQRPaymentData } from '../../types'

interface BankQRPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  payment: BankQRPaymentData | null
}

export function BankQRPaymentDialog(props: BankQRPaymentDialogProps) {
  const { t, i18n } = useTranslation()
  const qrContainerRef = useRef<HTMLDivElement>(null)

  if (!props.payment) {
    return null
  }
  const payment = props.payment

  const formattedAmount = new Intl.NumberFormat(toIntlLocale(i18n.language), {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(props.payment.amount)

  const downloadQRCode = () => {
    const svg = qrContainerRef.current?.querySelector('svg')
    if (!svg) return

    const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
      type: 'image/svg+xml;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `vietqr-${payment.trade_no}.svg`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Pay by bank transfer')}
      description={t(
        'Scan the VietQR code or copy the bank details to complete your transfer.'
      )}
      contentClassName='sm:max-w-xl'
      footer={
        <Button onClick={() => props.onOpenChange(false)}>
          {t('I have completed the transfer')}
        </Button>
      }
    >
      <div className='space-y-4'>
        <div className='border-warning/40 bg-warning/10 text-warning-foreground flex gap-3 rounded-lg border p-3 text-sm'>
          <AlertTriangle
            className='mt-0.5 size-4 shrink-0'
            aria-hidden='true'
          />
          <div>
            <p className='font-medium'>{t('Transfer the exact amount')}</p>
            <p>
              {t(
                'Use the exact transfer content below. Your balance will be credited after an administrator verifies the payment.'
              )}
            </p>
          </div>
        </div>

        <div className='grid gap-5 sm:grid-cols-[220px_1fr]'>
          <div className='flex flex-col items-center gap-2'>
            <div
              ref={qrContainerRef}
              className='rounded-xl border bg-white p-3 shadow-sm'
            >
              <QRCodeSVG
                value={props.payment.payload}
                size={192}
                level='M'
                includeMargin
              />
            </div>
            <p className='text-muted-foreground text-center text-xs'>
              {t('Scan with your banking app')}
            </p>
            <Button variant='outline' size='sm' onClick={downloadQRCode}>
              <Download aria-hidden='true' />
              {t('Download QR code')}
            </Button>
          </div>

          <div className='space-y-3'>
            <div className='bg-primary/5 border-primary/20 rounded-lg border p-3 text-center'>
              <p className='text-muted-foreground text-xs'>
                {t('Exact transfer amount')}
              </p>
              <div className='flex items-center justify-center gap-1'>
                <p className='text-primary text-2xl font-bold tabular-nums'>
                  {formattedAmount}
                </p>
                <CopyButton
                  value={String(props.payment.amount)}
                  tooltip={t('Copy amount')}
                  aria-label={t('Copy amount')}
                />
              </div>
            </div>

            <PaymentDetail
              label={t('Bank')}
              value={props.payment.bank_name}
              icon={<Landmark className='size-4' aria-hidden='true' />}
            />
            <PaymentDetail
              label={t('Account number')}
              value={props.payment.account_number}
              copyLabel={t('Copy account number')}
            />
            <PaymentDetail
              label={t('Account holder')}
              value={props.payment.account_name}
            />
            <PaymentDetail
              label={t('Transfer content')}
              value={props.payment.transfer_content}
              copyLabel={t('Copy transfer content')}
              emphasis
            />
            <PaymentDetail
              label={t('Order number')}
              value={props.payment.trade_no}
            />
          </div>
        </div>
      </div>
    </Dialog>
  )
}

interface PaymentDetailProps {
  label: string
  value: string
  copyLabel?: string
  icon?: ReactNode
  emphasis?: boolean
}

function PaymentDetail(props: PaymentDetailProps) {
  return (
    <div className='flex items-center justify-between gap-2 border-b pb-2'>
      <div className='min-w-0'>
        <p className='text-muted-foreground flex items-center gap-1.5 text-xs'>
          {props.icon}
          {props.label}
        </p>
        <p
          className={`text-sm break-all ${props.emphasis ? 'text-primary font-bold' : 'font-medium'}`}
        >
          {props.value}
        </p>
      </div>
      {props.copyLabel ? (
        <CopyButton
          value={props.value}
          tooltip={props.copyLabel}
          aria-label={props.copyLabel}
        />
      ) : null}
    </div>
  )
}
