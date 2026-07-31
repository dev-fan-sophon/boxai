import { CheckinSettingsSection } from '../general/checkin-settings-section'
import { QuotaSettingsSection } from '../general/quota-settings-section'
import type { BillingSettings } from '../types'
import { createSectionRegistry } from '../utils/section-registry'
import { MovedToPricingCenterSection } from './moved-section'
import {
  BILLING_DEFAULT_SECTION,
  BILLING_SECTION_IDS,
  type BillingSectionId,
} from './section-manifest'

const BILLING_SECTIONS = [
  {
    id: 'quota',
    titleKey: 'Quota Settings',
    build: (settings: BillingSettings) => (
      <QuotaSettingsSection
        defaultValues={{
          QuotaForNewUser: settings.QuotaForNewUser,
          PreConsumedQuota: settings.PreConsumedQuota,
          QuotaForInviter: settings.QuotaForInviter,
          QuotaForInvitee: settings.QuotaForInvitee,
          TopUpLink: settings.TopUpLink,
          general_setting: {
            docs_link: settings['general_setting.docs_link'],
          },
          quota_setting: {
            enable_free_model_pre_consume:
              settings['quota_setting.enable_free_model_pre_consume'],
          },
        }}
      />
    ),
  },
  {
    id: 'checkin',
    titleKey: 'Check-in Rewards',
    build: (settings: BillingSettings) => (
      <CheckinSettingsSection
        defaultValues={{
          enabled: settings['checkin_setting.enabled'],
          minQuota: settings['checkin_setting.min_quota'],
          maxQuota: settings['checkin_setting.max_quota'],
        }}
      />
    ),
  },
  {
    id: 'moved',
    titleKey: 'Moved to Pricing Center',
    build: () => <MovedToPricingCenterSection />,
  },
] as const

const billingRegistry = createSectionRegistry<
  BillingSectionId,
  BillingSettings
>({
  sectionIds: BILLING_SECTION_IDS,
  sections: BILLING_SECTIONS,
  defaultSection: BILLING_DEFAULT_SECTION,
  basePath: '/system-settings/billing',
  urlStyle: 'path',
})

export const getBillingSectionNavItems = billingRegistry.getSectionNavItems
export const getBillingSectionContent = billingRegistry.getSectionContent
export const getBillingSectionMeta = billingRegistry.getSectionMeta
