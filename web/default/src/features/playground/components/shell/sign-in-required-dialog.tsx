import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

/** Shown when a guest tries to run a model; returns them here after sign-in. */
export function SignInRequiredDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  redirect: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Sign in required')}
      description={t('Please sign in to send requests with AI models.')}
      contentClassName='sm:max-w-md'
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            onClick={() =>
              navigate({ to: '/sign-in', search: { redirect: props.redirect } })
            }
          >
            {t('Sign in now')}
          </Button>
        </>
      }
    >
      <span />
    </Dialog>
  )
}
