import { useTranslation } from 'react-i18next'

import { Wrench } from '@/components/icons'
import { Button } from '@/components/ui/button'

import { ErrorPage } from './error-page'

export function MaintenanceError(props: { embedded?: boolean }) {
  const { t } = useTranslation()
  return (
    <ErrorPage
      embedded={props.embedded}
      code='503'
      icon={<Wrench />}
      iconTone='info'
      title={t('Under maintenance')}
      description={t(
        "We're doing a short upgrade. Please try again in a few minutes."
      )}
      actions={
        <Button variant='outline' onClick={() => window.location.reload()}>
          {t('Try again')}
        </Button>
      }
    />
  )
}
