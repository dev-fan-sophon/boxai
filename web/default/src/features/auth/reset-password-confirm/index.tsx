import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CheckIcon,
  CopyIcon,
  KeyRound,
} from '@/components/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCountdown } from '@/hooks/use-countdown'
import { api } from '@/lib/api'
import { copyToClipboard } from '@/lib/copy-to-clipboard'

import { AuthLayout } from '../auth-layout'

export type ResetPasswordSearchParams = {
  email?: string
  token?: string
}

type ResetPasswordConfirmProps = ResetPasswordSearchParams

export function ResetPasswordConfirm({
  email,
  token,
}: ResetPasswordConfirmProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const {
    secondsLeft,
    isActive,
    start: startCountdown,
  } = useCountdown({ initialSeconds: 30 })

  const isValidResetLink = Boolean(email && token)

  async function handleSubmit() {
    if (!isValidResetLink || !email || !token) {
      toast.error(t('Invalid reset link, please request a new password reset'))
      return
    }

    startCountdown()
    setLoading(true)
    try {
      const res = await api.post('/api/user/reset', { email, token }, {
        skipBusinessError: true,
      } as Record<string, unknown>)

      if (res?.data?.success) {
        const password = res.data.data
        setNewPassword(password)
        const copySuccess = await copyToClipboard(password)
        if (copySuccess) {
          toast.success(
            t('Password reset and copied to clipboard: {{password}}', {
              password,
            })
          )
        } else {
          toast.success(t('Password reset: {{password}}', { password }))
        }
      }
    } catch {
      // Errors handled by global interceptor
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!newPassword) return

    const copySuccess = await copyToClipboard(newPassword)
    if (copySuccess) {
      setCopied(true)
      toast.success(
        t('Password copied to clipboard: {{password}}', {
          password: newPassword,
        })
      )
      setTimeout(() => setCopied(false), 2000)
    }
  }

  let submitLabel = t('auth.resetPasswordConfirm.confirm')
  if (newPassword) {
    submitLabel = t('auth.resetPasswordConfirm.backToLogin')
  } else if (isActive) {
    submitLabel = t('auth.resetPasswordConfirm.retry', {
      seconds: secondsLeft,
    })
  }

  return (
    <AuthLayout
      icon={
        <IconBadge tone={newPassword ? 'success' : 'primary'} size='lg'>
          {newPassword ? <CheckCircle2 /> : <KeyRound />}
        </IconBadge>
      }
      title={t('Reset password')}
      description={
        <p>
          {newPassword
            ? t('auth.resetPasswordConfirm.success')
            : t('auth.resetPasswordConfirm.description')}
        </p>
      }
    >
      <div className='grid gap-5'>
        {!isValidResetLink && (
          <Alert variant='destructive'>
            <AlertCircle aria-hidden='true' />
            <AlertDescription>
              {t('Invalid reset link, please request a new password reset.')}
            </AlertDescription>
          </Alert>
        )}

        <div className='grid gap-2'>
          <Label htmlFor='email'>{t('Email')}</Label>
          <Input
            id='email'
            type='email'
            value={email || ''}
            disabled
            placeholder={t('Waiting for email...')}
          />
        </div>

        {newPassword && (
          <div className='grid gap-2'>
            <Label htmlFor='password'>{t('New password')}</Label>
            <div className='flex gap-2'>
              <Input
                id='password'
                value={newPassword}
                readOnly
                className='min-w-0 flex-1 font-mono'
              />
              <Button
                type='button'
                size='icon'
                variant='outline'
                onClick={handleCopy}
                aria-label={copied ? t('Copied!') : t('Copy password')}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </Button>
            </div>
            <p className='text-muted-foreground text-xs'>
              {t('Password has been copied to clipboard')}
            </p>
          </div>
        )}

        <Button
          size='lg'
          className='w-full justify-center'
          onClick={
            newPassword
              ? () => navigate({ to: '/sign-in', replace: true })
              : handleSubmit
          }
          disabled={
            newPassword ? false : loading || isActive || !isValidResetLink
          }
        >
          {submitLabel}
        </Button>

        {!newPassword && (
          <Button
            variant='ghost'
            className='w-full justify-center'
            onClick={() => navigate({ to: '/sign-in', replace: true })}
          >
            <ArrowLeft />
            {t('Back to login')}
          </Button>
        )}
      </div>
    </AuthLayout>
  )
}
