import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { ShieldCheck } from '@/components/icons'
import { IconBadge } from '@/components/ui/icon-badge'

import { AuthLayout } from '../auth-layout'
import { OtpForm } from './components/otp-form'

export function Otp() {
  const { t } = useTranslation()
  return (
    <AuthLayout
      icon={
        <IconBadge tone='primary' size='lg'>
          <ShieldCheck />
        </IconBadge>
      }
      title={t('Two-factor Authentication')}
      description={
        <>
          <p>{t('Please enter the authentication code.')}</p>
          <p>
            {t('Session expired?')}{' '}
            <Link
              to='/sign-in'
              className='text-foreground hover:text-primary font-medium underline-offset-4 transition-colors hover:underline'
            >
              {t('Re-login')}
            </Link>
          </p>
        </>
      }
    >
      <OtpForm />
    </AuthLayout>
  )
}
