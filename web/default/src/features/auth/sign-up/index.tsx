import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { AuthLayout } from '../auth-layout'
import { SignUpForm } from './components/sign-up-form'

export function SignUp() {
  const { t } = useTranslation()

  return (
    <AuthLayout
      title={t('Create an account')}
      description={
        <p>
          {t('Already have an account?')}{' '}
          <Link
            to='/sign-in'
            className='text-foreground hover:text-primary font-medium underline-offset-4 transition-colors hover:underline'
          >
            {t('Sign in')}
          </Link>
        </p>
      }
    >
      {/* Legal consent checkbox lives in SignUpForm; no duplicate footer. */}
      <SignUpForm />
    </AuthLayout>
  )
}
