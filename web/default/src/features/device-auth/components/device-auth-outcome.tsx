import { Link } from '@tanstack/react-router'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

export function DeviceAuthOutcome(props: { outcome: 'approved' | 'denied' }) {
  const { t } = useTranslation()
  const approved = props.outcome === 'approved'

  return (
    <div className='flex flex-col items-start gap-4 rounded-xl border p-5'>
      <div className='flex items-center gap-2'>
        {approved ? (
          <CheckCircle2
            className='size-5 text-emerald-500'
            aria-hidden='true'
          />
        ) : (
          <XCircle className='text-destructive size-5' aria-hidden='true' />
        )}
        <h3 className='text-sm font-semibold'>
          {approved ? t('Device authorized') : t('Request denied')}
        </h3>
      </div>
      <p className='text-muted-foreground text-sm'>
        {approved
          ? t('You can close this page and return to the desktop app.')
          : t('The desktop app was not granted access to your account.')}
      </p>
      {approved ? (
        <Button variant='outline' render={<Link to='/keys' />}>
          {t('Manage API keys')}
        </Button>
      ) : null}
    </div>
  )
}
