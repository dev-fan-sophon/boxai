import { Link, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'

import { AuthLayout } from '../auth-layout'
import { TermsFooter } from '../components/terms-footer'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { t } = useTranslation()
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const { status } = useStatus()
  const canRegister =
    !status?.self_use_mode_enabled && status?.register_enabled !== false

  return (
    <AuthLayout
      title={t('Sign in')}
      description={
        canRegister ? (
          <p>
            {t("Don't have an account?")}{' '}
            <Link
              to='/sign-up'
              search={redirect ? { redirect } : undefined}
              className='text-foreground hover:text-primary font-medium underline-offset-4 transition-colors hover:underline'
            >
              {t('Sign up')}
            </Link>
          </p>
        ) : undefined
      }
    >
      <UserAuthForm redirectTo={redirect} />
      <TermsFooter variant='sign-in' status={status} className='mt-8' />
    </AuthLayout>
  )
}
