import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toastPromise } from '@/lib/toast'

import { deleteApiKey } from '../api'
import { SUCCESS_MESSAGES } from '../constants'
import { useApiKeys } from './api-keys-provider'

export function ApiKeysDeleteDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, triggerRefresh } = useApiKeys()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!currentRow) return

    setIsDeleting(true)
    try {
      // The button carries the pending state, so no loading toast.
      const result = await toastPromise(deleteApiKey(currentRow.id), {
        success: t(SUCCESS_MESSAGES.API_KEY_DELETED),
      })
      if (!result.success) return
      setOpen(null)
      triggerRefresh()
    } catch {
      /* already toasted by toastPromise */
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog
      open={open === 'delete'}
      onOpenChange={(open) => !open && setOpen(null)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('Are you sure?')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('This will permanently delete API key')}{' '}
            <span className='font-semibold'>{currentRow?.name}</span>
            {t('. This action cannot be undone.')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {t('Cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            loading={isDeleting}
            variant='destructive'
          >
            {t('Delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
