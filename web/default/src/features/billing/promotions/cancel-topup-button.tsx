import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'

import { cancelTopUp } from './api'

export function CancelTopUpButton(props: {
  tradeNo: string
  onCancelled: () => void
}) {
  const { t } = useTranslation()
  const mutation = useMutation({
    mutationFn: () => cancelTopUp(props.tradeNo),
    onSuccess: () => {
      toast.success(t('Order cancelled'))
      props.onCancelled()
    },
    onError: (error) => {
      if (error instanceof Error) toast.error(error.message)
      else handleServerError(error)
    },
  })
  return (
    <Button
      variant='outline'
      disabled={mutation.isPending}
      onClick={() => {
        if (
          window.confirm(
            t(
              'Cancel this unpaid order? Do not transfer funds after cancellation.'
            )
          )
        ) {
          mutation.mutate()
        }
      }}
    >
      {t('Cancel order')}
    </Button>
  )
}
