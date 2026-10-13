import { SettingsPage } from '../components/settings-page'
import type { SiteSettings } from '../types'
import { SITE_DEFAULT_SECTION } from './section-manifest'
import {
  getSiteSectionContent,
  getSiteSectionMeta,
} from './section-registry.tsx'

const defaultSiteSettings: SiteSettings = {
  'branding.favicon_url': '',
  'branding.primary_color': '',
  'branding.primary_color_dark': '',
  Notice: '',
  SystemName: 'BoxAI',
  Logo: '',
  Footer: '',
  About: '',
  HomePageContent: '',
  ServerAddress: '',
  'legal.user_agreement': '',
  'legal.privacy_policy': '',
  HeaderNavModules: '',
  SidebarModulesAdmin: '',
}

export function SiteSettings() {
  return (
    <SettingsPage
      routePath='/_authenticated/system-settings/site/$section'
      defaultSettings={defaultSiteSettings}
      defaultSection={SITE_DEFAULT_SECTION}
      getSectionContent={getSiteSectionContent}
      getSectionMeta={getSiteSectionMeta}
    />
  )
}
