import { SettingsPage } from '../components/settings-page'
import { BILLING_DEFAULT_SECTION } from './section-manifest'
import {
  getBillingSectionContent,
  getBillingSectionMeta,
} from './section-registry.tsx'
import { defaultBillingSettings } from './settings-defaults'

export function BillingSettings() {
  return (
    <SettingsPage
      routePath='/_authenticated/system-settings/billing/$section'
      defaultSettings={defaultBillingSettings}
      defaultSection={BILLING_DEFAULT_SECTION}
      getSectionContent={getBillingSectionContent}
      getSectionMeta={getBillingSectionMeta}
    />
  )
}
