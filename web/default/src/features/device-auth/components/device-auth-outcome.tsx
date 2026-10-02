import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { CheckCircle2, XCircle } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'

export function DeviceAuthOutcome(props: { outcome: 'approved' | 'denied' }) {
  const { t } = useTranslation()
  const approved = props.outcome === 'approved'

  return (
    <Card>
      <CardContent className='flex flex-col items-center gap-4 py-4 text-center'>
        <IconBadge
          tone={approved ? 'success' : 'destructive'}
          size='lg'
          className='size-14 rounded-2xl [&>svg]:size-7'
        >
          {approved ? <CheckCircle2 /> : <XCircle />}
        </IconBadge>
        <div className='space-y-1.5'>
          <h3 className='text-lg font-semibold tracking-tight'>
            {approved ? t('Device authorized') : t('Request denied')}
          </h3>
          <p className='text-muted-foreground text-sm text-pretty'>
            {approved
              ? t('You can close this page and return to the desktop app.')
              : t('The desktop app was not granted access to your account.')}
          </p>
        </div>
        {approved ? (
          <Button variant='outline' render={<Link to='/keys' />}>
            {t('Manage API keys')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
