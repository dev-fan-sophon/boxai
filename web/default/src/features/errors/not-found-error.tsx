import { useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { SearchX } from '@/components/icons'
import { Button } from '@/components/ui/button'

import { ErrorPage } from './error-page'

export function NotFoundError(props: { embedded?: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { history } = useRouter()
  return (
    <ErrorPage
      embedded={props.embedded}
      code='404'
      icon={<SearchX />}
      title={t('Page not found')}
      description={t(
        "This page doesn't exist or may have been moved. Check the URL, or head back home."
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
