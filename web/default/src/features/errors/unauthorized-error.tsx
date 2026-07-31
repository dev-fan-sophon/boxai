import { useNavigate, useRouter } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { ErrorPage } from './error-page'

export function UnauthorisedError() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <ErrorPage
      code='401'
      icon={<KeyRound />}
      iconTone='warning'
      title={t('Sign in required')}
      description={t(
        'Please sign in with an account that has access to continue.'
      )}
      actions={
        <>
          <Button variant='outline' onClick={() => history.go(-1)}>
            {t('Go Back')}
          </Button>
          <Button onClick={() => navigate({ to: '/sign-in' })}>
            {t('Sign in')}
          </Button>
          <Button variant='outline' onClick={() => navigate({ to: '/' })}>
            {t('Back to Home')}
          </Button>
        </>
      }
    />
  )
}
