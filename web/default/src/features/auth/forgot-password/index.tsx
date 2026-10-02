import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Mail } from '@/components/icons'
import { IconBadge } from '@/components/ui/icon-badge'

import { AuthLayout } from '../auth-layout'
import { ForgotPasswordForm } from './components/forgot-password-form'

export function ForgotPassword() {
  const { t } = useTranslation()
  return (
    <AuthLayout
      icon={
        <IconBadge tone='primary' size='lg'>
          <Mail />
        </IconBadge>
      }
      title={t('Forgot password')}
      description={
        <p>
          {t(
            'Enter your registered email and we will send you a link to reset your password.'
          )}
        </p>
      }
    >
      <ForgotPasswordForm />
      <p className='text-muted-foreground mt-8 text-sm'>
        {t("Don't have an account?")}{' '}
        <Link
          to='/sign-up'
          className='text-foreground hover:text-primary font-medium underline-offset-4 transition-colors hover:underline'
        >
          {t('Sign up')}
        </Link>
      </p>
    </AuthLayout>
  )
}
