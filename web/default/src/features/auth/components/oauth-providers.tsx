import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getBrandIcon,
  IconDiscord,
  IconFacebook,
  IconGithub,
  IconGoogle,
  IconLinuxDo,
  IconWeChat,
  IconZalo,
} from '@/assets/brand-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { useOAuthLogin } from '../hooks/use-oauth-login'
import type { SystemStatus } from '../types'
import { AuthDivider } from './auth-divider'

type OAuthProvidersProps = {
  status: SystemStatus | null
  disabled?: boolean
  className?: string
  onWeChatLogin?: () => void
  isWeChatLoading?: boolean
  /** Render an "or" divider above the buttons (only when any provider is on). */
  dividerBefore?: boolean
}

type ProviderButton = {
  key: string
  label: string
  /** Provider name alone, used when the list collapses into a grid. */
  shortLabel: string
  onClick: () => void
  icon?: ReactNode
  disabled?: boolean
}

export function OAuthProviders({
  status,
  disabled = false,
  className,
  onWeChatLogin,
  isWeChatLoading = false,
  dividerBefore = false,
}: OAuthProvidersProps) {
  const { t } = useTranslation()
  const {
    isLoading,
    githubButtonText,
    githubButtonDisabled,
    handleGitHubLogin,
    handleDiscordLogin,
    handleGoogleLogin,
    handleFacebookLogin,
    handleZaloLogin,
    handleOIDCLogin,
    handleLinuxDOLogin,
    handleTelegramLogin,
    handleCustomOAuthLogin,
  } = useOAuthLogin(status)

  const providerButtons: ProviderButton[] = []

  // Vietnam-first ordering: Zalo leads, then the global providers.
  if (status?.zalo_oauth) {
    providerButtons.push({
      key: 'zalo',
      shortLabel: 'Zalo',
      label: t('Continue with Zalo'),
      onClick: handleZaloLogin,
      icon: <IconZalo className='size-4' />,
    })
  }

  if (status?.google_oauth) {
    providerButtons.push({
      key: 'google',
      shortLabel: 'Google',
      label: t('Continue with Google'),
      onClick: handleGoogleLogin,
      icon: <IconGoogle className='size-4' />,
    })
  }

  if (status?.github_oauth) {
    providerButtons.push({
      key: 'github',
      shortLabel: githubButtonDisabled ? githubButtonText : 'GitHub',
      label: githubButtonText || t('Continue with GitHub'),
      onClick: handleGitHubLogin,
      icon: <IconGithub className='size-4' />,
      disabled: githubButtonDisabled,
    })
  }

  if (status?.discord_oauth) {
    providerButtons.push({
      key: 'discord',
      shortLabel: 'Discord',
      label: t('Continue with Discord'),
      onClick: handleDiscordLogin,
      icon: <IconDiscord className='size-4' />,
    })
  }

  if (status?.facebook_oauth) {
    providerButtons.push({
      key: 'facebook',
      shortLabel: 'Facebook',
      label: t('Continue with Facebook'),
      onClick: handleFacebookLogin,
      icon: <IconFacebook className='size-4' />,
    })
  }

  if (status?.wechat_login && onWeChatLogin) {
    providerButtons.push({
      key: 'wechat',
      shortLabel: 'WeChat',
      label: t('Continue with WeChat'),
      onClick: onWeChatLogin,
      icon: <IconWeChat className='size-4' />,
      disabled: isWeChatLoading,
    })
  }

  if (status?.oidc_enabled) {
    const oidcDisplayName = status.oidc_display_name?.trim() || 'OIDC'
    providerButtons.push({
      key: 'oidc',
      shortLabel: oidcDisplayName,
      label: t('Continue with {{name}}', { name: oidcDisplayName }),
      onClick: handleOIDCLogin,
    })
  }

  if (status?.linuxdo_oauth) {
    providerButtons.push({
      key: 'linuxdo',
      shortLabel: 'LinuxDO',
      label: t('Continue with LinuxDO'),
      onClick: handleLinuxDOLogin,
      icon: <IconLinuxDo className='size-4' />,
    })
  }

  if (status?.telegram_oauth) {
    providerButtons.push({
      key: 'telegram',
      shortLabel: 'Telegram',
      label: t('Continue with Telegram'),
      onClick: handleTelegramLogin,
    })
  }

  // Custom OAuth providers
  const customProviders = status?.custom_oauth_providers
  if (customProviders && customProviders.length > 0) {
    for (const provider of customProviders) {
      const BrandIcon = getBrandIcon(provider.icon)
      providerButtons.push({
        key: `custom-${provider.slug}`,
        shortLabel: provider.name,
        label: t('Continue with {{name}}', { name: provider.name }),
        onClick: () => handleCustomOAuthLogin(provider),
        icon: BrandIcon ? <BrandIcon className='size-4' /> : undefined,
      })
    }
  }

  if (providerButtons.length === 0) return null

  // With many providers the full-width stack gets long: keep the first
  // (Zalo when enabled) prominent and collapse the rest into a 2-col grid.
  const compact = providerButtons.length >= 4
  const [leadButton, ...restButtons] = providerButtons

  const renderButton = (button: ProviderButton, short: boolean) => (
    <Button
      key={button.key}
      variant='outline'
      size='lg'
      type='button'
      disabled={disabled || isLoading || button.disabled}
      onClick={button.onClick}
      aria-label={short ? button.label : undefined}
      title={short ? button.label : undefined}
      className='w-full min-w-0 justify-center gap-2.5'
    >
      {button.icon}
      <span className='min-w-0 truncate'>
        {short ? button.shortLabel : button.label}
      </span>
    </Button>
  )

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {dividerBefore && <AuthDivider className='mb-3' />}
      {compact ? (
        <>
          {renderButton(leadButton, false)}
          <div className='grid grid-cols-2 gap-2 [&>*:last-child:nth-child(odd)]:col-span-2'>
            {restButtons.map((button) => renderButton(button, true))}
          </div>
        </>
      ) : (
        providerButtons.map((button) => renderButton(button, false))
      )}
    </div>
  )
}
