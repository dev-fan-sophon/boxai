import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SiGithub, SiLinux, SiWechat } from 'react-icons/si'

import {
  IconDiscord,
  IconFacebook,
  IconGoogle,
  IconZalo,
} from '@/assets/brand-icons'
import {
  Loader2,
  Send,
  Shield,
  UserRound,
  type IconComponent,
} from '@/components/icons'

import { AuthLayout } from '../auth-layout'

type OAuthCallbackScreenProps = {
  provider: string
  mode: 'login' | 'bind'
}

type ProviderMeta = {
  label: string
  Icon: IconComponent | ((props: { className?: string }) => React.JSX.Element)
}

const providerDictionary: Record<string, ProviderMeta> = {
  github: {
    label: 'GitHub',
    Icon: (props: { className?: string }) => (
      <SiGithub className={props.className} focusable='false' />
    ),
  },
  discord: { label: 'Discord', Icon: IconDiscord },
  google: { label: 'Google', Icon: IconGoogle },
  facebook: { label: 'Facebook', Icon: IconFacebook },
  zalo: { label: 'Zalo', Icon: IconZalo },
  oidc: { label: 'OIDC', Icon: Shield },
  linuxdo: {
    label: 'LinuxDO',
    Icon: (props: { className?: string }) => (
      <SiLinux className={props.className} focusable='false' />
    ),
  },
  telegram: { label: 'Telegram', Icon: Send },
  wechat: {
    label: 'WeChat',
    Icon: (props: { className?: string }) => (
      <SiWechat className={props.className} focusable='false' />
    ),
  },
}

export function OAuthCallbackScreen({
  provider,
  mode,
}: OAuthCallbackScreenProps) {
  const { t } = useTranslation()
  const { label, Icon } = useMemo(() => {
    const normalized = provider?.toLowerCase() ?? ''
    return (
      providerDictionary[normalized] || {
        label: 'account',
        Icon: UserRound,
      }
    )
  }, [provider])

  const providerLabel = t(label)
  const isBindMode = mode === 'bind'

  const headline = isBindMode
    ? t('Binding your {{provider}} account', { provider: providerLabel })
    : t('Signing you in with {{provider}}', { provider: providerLabel })

  const description = isBindMode
    ? t('Hang tight while we securely link this account to your profile.')
    : t('Hang tight while we finish connecting your account.')

  const secondaryNote = isBindMode
    ? t(
        'You can close this tab once the binding completes or a success message appears in the original window.'
      )
    : t(
        "You'll be redirected automatically. You can return to the previous page if nothing happens after a few seconds."
      )

  return (
    <AuthLayout
      icon={
        <span className='bg-card ring-border shadow-panel relative flex size-14 items-center justify-center rounded-2xl ring-1'>
          <Icon className='size-7' />
          <span className='bg-background ring-border absolute -right-1.5 -bottom-1.5 flex size-6 items-center justify-center rounded-full ring-1'>
            <Loader2 className='text-primary size-3.5 animate-spin' />
          </span>
        </span>
      }
      title={headline}
      description={<p>{description}</p>}
    >
      <div
        className='bg-surface-subtle ring-border/60 space-y-2 rounded-2xl p-4 ring-1'
        role='status'
        aria-live='polite'
      >
        <p className='flex items-center gap-2 text-sm font-medium'>
          <Loader2 className='size-4 shrink-0 animate-spin' aria-hidden />
          <span className='min-w-0'>{t('Processing OAuth response...')}</span>
        </p>
        <p className='text-muted-foreground text-sm'>{secondaryNote}</p>
        <p className='text-muted-foreground text-xs'>
          {t(
            'This may take a few moments while we validate the request and update your session.'
          )}
        </p>
      </div>
    </AuthLayout>
  )
}
