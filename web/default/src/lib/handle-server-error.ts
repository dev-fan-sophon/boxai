import i18next from 'i18next'
import { toast } from 'sonner'

import { getServerErrorMessage, isErrorReported } from '@/lib/toast'

export function handleServerError(error: unknown) {
  // eslint-disable-next-line no-console
  console.log(error)

  // The axios interceptor already toasted this failure with the server's
  // message; a second toast for the same request is noise.
  if (isErrorReported(error)) return

  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    Number(error.status) === 204
  ) {
    toast.error(i18next.t('Content not found.'))
    return
  }

  toast.error(getServerErrorMessage(error))
}
