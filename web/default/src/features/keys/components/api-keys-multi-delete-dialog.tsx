import type { Table } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { toastPromise } from '@/lib/toast'

import { batchDeleteApiKeys } from '../api'
import type { ApiKey } from '../types'
import { useApiKeys } from './api-keys-provider'

type ApiKeysMultiDeleteDialogProps<TData> = {
  open: boolean
  onOpenChange: (open: boolean) => void
  table: Table<TData>
}

export function ApiKeysMultiDeleteDialog<TData>({
  open,
  onOpenChange,
  table,
}: ApiKeysMultiDeleteDialogProps<TData>) {
  const { t } = useTranslation()
  const { triggerRefresh } = useApiKeys()
  const [isDeleting, setIsDeleting] = useState(false)
  const selectedRows = table.getFilteredSelectedRowModel().rows

  const handleConfirm = async () => {
    setIsDeleting(true)
    try {
      const ids = selectedRows.map((row) => (row.original as ApiKey).id)
      const result = await toastPromise(batchDeleteApiKeys(ids), {
        success: (res) =>
          t('Successfully deleted {{count}} API key(s)', {
            count: res.data || ids.length,
          }),
      })
      if (!result.success) return
      table.resetRowSelection()
      triggerRefresh()
      onOpenChange(false)
    } catch {
      /* already toasted by toastPromise */
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <ConfirmDialog
      destructive
      open={open}
      onOpenChange={onOpenChange}
      handleConfirm={handleConfirm}
      isLoading={isDeleting}
      className='max-w-md'
      title={t('Delete {{count}} API key(s)?', { count: selectedRows.length })}
      desc={
        <>
          {t('You are about to delete {{count}} API key(s).', {
            count: selectedRows.length,
          })}{' '}
          <br />
          {t('This action cannot be undone.')}
        </>
      }
      confirmText={t('Delete')}
    />
  )
}
