import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { defaultBillingSettings } from '@/features/system-settings/billing/settings-defaults'
import {
  getOptionValue,
  useSystemOptions,
} from '@/features/system-settings/hooks/use-system-options'

import { RewardActivityPanel } from './reward-activity-panel'
import { RewardCampaignsPanel } from './reward-campaigns-panel'
import { RewardSettingsSection } from './reward-settings-section'

export function RewardsTab() {
  const { t } = useTranslation()
  const { data, isLoading } = useSystemOptions()
  const settings = useMemo(
    () => getOptionValue(data?.data, defaultBillingSettings),
    [data?.data]
  )

  if (isLoading) {
    return (
      <div className='text-muted-foreground flex min-h-40 items-center justify-center text-sm'>
        {t('Loading settings...')}
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-6 overflow-y-auto pr-1'>
      <RewardSettingsSection
        defaultValues={{
          enabled: settings['reward_setting.enabled'] ?? false,
          requireVerified: settings['reward_setting.require_verified'] ?? false,
          expirePendingDays:
            settings['reward_setting.expire_pending_days'] ?? 0,
          minRedeemQuota: settings['reward_setting.min_redeem_quota'] ?? 0,
          defaultPerUserLimit:
            settings['reward_setting.default_per_user_limit'] ?? 1,
        }}
      />
      <RewardCampaignsPanel />
      <RewardActivityPanel />
    </div>
  )
}
