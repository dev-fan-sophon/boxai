import { useNavigate, useRouter } from '@tanstack/react-router'
import { ShieldX } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { ErrorPage } from './error-page'

export function ForbiddenError() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <ErrorPage
      code='403'
      icon={<ShieldX />}
      iconTone='destructive'
      title={t('Access forbidden')}
      description={t(
        "You don't have permission to view this page. Switch accounts or go back home."
      )}
      actions={
        <>
          <Button variant='outline' onClick={() => history.go(-1)}>
            {t('Go Back')}
          </Button>
          <Button onClick={() => navigate({ to: '/' })}>
            {t('Back to Home')}
          </Button>
        </>
      }
    />
  )
}
