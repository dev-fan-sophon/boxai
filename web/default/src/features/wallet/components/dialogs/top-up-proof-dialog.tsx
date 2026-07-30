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
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { getTopUpSubmissions, submitTopUpProof } from '../../api'
import type { TopUpSubmission } from '../../types'

const MAX_PROOF_SIZE = 10 * 1024 * 1024
const PROOF_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

interface TopUpProofDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tradeNo: string | null
  onSubmitted?: () => void
}

export function TopUpProofDialog(props: TopUpProofDialogProps) {
  const { t } = useTranslation()
  const [transactionNo, setTransactionNo] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [latestSubmission, setLatestSubmission] =
    useState<TopUpSubmission | null>(null)

  useEffect(() => {
    if (!props.open) {
      setTransactionNo('')
      setNote('')
      setFile(null)
      setError('')
      setLatestSubmission(null)
      return
    }
    if (!props.tradeNo) return
    void getTopUpSubmissions(props.tradeNo)
      .then((response) => setLatestSubmission(response.data?.[0] || null))
      .catch(() => setLatestSubmission(null))
  }, [props.open, props.tradeNo])

  const handleFileChange = (selected: File | null) => {
    if (selected && !PROOF_TYPES.has(selected.type)) {
      setFile(null)
      setError(t('Upload a JPG, PNG, or WebP image'))
      return
    }
    if (selected && selected.size > MAX_PROOF_SIZE) {
      setFile(null)
      setError(t('The proof image must be 10 MB or smaller'))
      return
    }
    setFile(selected)
    setError('')
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!transactionNo.trim() && !file) {
      setError(t('Enter a transaction number or upload a proof image'))
      return
    }
    if (!props.tradeNo) return
    if (latestSubmission?.status === 'submitted') return

    const formData = new FormData()
    formData.append('bank_transaction_no', transactionNo.trim())
    formData.append('note', note.trim())
    if (file) formData.append('file', file)

    setSubmitting(true)
    setError('')
    try {
      const response = await submitTopUpProof(props.tradeNo, formData)
      if (response.success || response.message === 'success') {
        toast.success(t('Payment proof submitted. Please wait for review.'))
        props.onSubmitted?.()
        props.onOpenChange(false)
      } else {
        setError(response.message || t('Failed to submit payment proof'))
      }
    } catch {
      setError(t('Failed to submit payment proof'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Submit payment proof')}
      description={t(
        'Provide your bank transaction number or a payment screenshot.'
      )}
      contentClassName='sm:max-w-md'
    >
      <form className='space-y-4' onSubmit={handleSubmit}>
        {latestSubmission ? (
          <div className='bg-muted rounded-md p-3 text-sm'>
            <p className='font-medium'>
              {t(
                latestSubmission.status === 'rejected'
                  ? 'Rejected'
                  : 'Submitted'
              )}
            </p>
            {latestSubmission.review_note ? (
              <p className='text-muted-foreground mt-1'>
                {t('Review note')}: {latestSubmission.review_note}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className='space-y-1.5'>
          <Label htmlFor='bank-transaction-no'>
            {t('Bank transaction number')}
          </Label>
          <Input
            id='bank-transaction-no'
            value={transactionNo}
            onChange={(event) => setTransactionNo(event.target.value)}
            placeholder={t('Enter the transaction number')}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='payment-proof'>{t('Payment screenshot')}</Label>
          <Input
            id='payment-proof'
            type='file'
            accept='image/jpeg,image/png,image/webp'
            onChange={(event) =>
              handleFileChange(event.target.files?.[0] || null)
            }
          />
          <p className='text-muted-foreground text-xs'>
            {t('JPG, PNG, or WebP; maximum 10 MB')}
          </p>
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='payment-note'>{t('Note')}</Label>
          <Textarea
            id='payment-note'
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        {error ? (
          <p role='alert' className='text-destructive text-sm'>
            {error}
          </p>
        ) : null}
        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={submitting}
          >
            {t('Submit later')}
          </Button>
          <Button
            type='submit'
            disabled={submitting || latestSubmission?.status === 'submitted'}
          >
            {submitting ? t('Submitting...') : t('Submit payment proof')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
