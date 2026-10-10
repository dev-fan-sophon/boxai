import { t } from 'i18next'

/** Only local, structured funding codes may direct a user to pay. */
export function getFundingError(code: unknown) {
  switch (code) {
    case 'insufficient_user_quota':
      return {
        title: t('Insufficient balance'),
        description: t(
          'Your wallet balance cannot cover this request. Top up, then retry.'
        ),
        action: t('Top up'),
        href: '/billing?topup=true',
      }
    case 'insufficient_subscription_quota':
      return {
        title: t('Insufficient subscription quota'),
        description: t(
          'Your plan cannot cover this request. Review your subscription or wait for your quota to reset.'
        ),
        action: t('Manage subscription'),
        href: '/billing#billing-subscription',
      }
    case 'subscription_overage_disabled':
      return {
        title: t('Extra usage is disabled'),
        description: t(
          'Your subscription quota is exhausted. Enable extra usage to use your wallet balance, or wait for your quota to reset.'
        ),
        action: t('Manage extra usage'),
        href: '/billing',
      }
    case 'subscription_overage_limit_exceeded':
      return {
        title: t('Extra usage limit reached'),
        description: t(
          'Adjust your extra usage limit in Wallet, or wait for your quota to reset. Topping up alone will not change this limit.'
        ),
        action: t('Manage extra usage'),
        href: '/billing',
      }
    case 'pre_consume_token_quota_failed':
      return {
        title: t('Insufficient API key quota'),
        description: t(
          'Increase this API key’s quota or use another key. Topping up your wallet will not change the key’s limit.'
        ),
        action: t('Manage API keys'),
        href: '/keys',
      }
    default:
      return null
  }
}

export function getServerErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const value = error as {
    code?: unknown
    error?: { code?: unknown }
    response?: { data?: unknown }
  }
  if (value.response?.data) return getServerErrorCode(value.response.data)
  const code = value.error?.code ?? value.code
  return typeof code === 'string' ? code : undefined
}
