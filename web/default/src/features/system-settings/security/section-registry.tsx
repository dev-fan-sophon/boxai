/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { EdgeProtectionSection } from '../edge-protection'
import { RateLimitSection } from '../request-limits/rate-limit-section'
import { RouteRateLimitSection } from '../request-limits/route-rate-limit-section'
import { SensitiveWordsSection } from '../request-limits/sensitive-words-section'
import { SSRFSection } from '../request-limits/ssrf-section'
import { TokenLimitSection } from '../request-limits/token-limit-section'
import { TrustedProxySection } from '../request-limits/trusted-proxy-section'
import type { SecuritySettings } from '../types'
import { createSectionRegistry } from '../utils/section-registry'
import {
  SECURITY_DEFAULT_SECTION,
  SECURITY_SECTION_IDS,
  type SecuritySectionId,
} from './section-manifest'

const SECURITY_SECTIONS = [
  {
    id: 'rate-limit',
    titleKey: 'Rate Limiting',
    build: (settings: SecuritySettings) => (
      <RateLimitSection
        defaultValues={{
          ModelRequestRateLimitEnabled: settings.ModelRequestRateLimitEnabled,
          ModelRequestRateLimitCount: settings.ModelRequestRateLimitCount,
          ModelRequestRateLimitSuccessCount:
            settings.ModelRequestRateLimitSuccessCount,
          ModelRequestRateLimitDurationMinutes:
            settings.ModelRequestRateLimitDurationMinutes,
          ModelRequestRateLimitGroup: settings.ModelRequestRateLimitGroup,
        }}
      />
    ),
  },
  {
    id: 'route-throttling',
    titleKey: 'Route Throttling',
    build: (settings: SecuritySettings) => (
      <RouteRateLimitSection
        defaultValues={{
          GlobalApiRateLimitEnabled: settings.GlobalApiRateLimitEnabled,
          GlobalApiRateLimitNum: settings.GlobalApiRateLimitNum,
          GlobalApiRateLimitDuration: settings.GlobalApiRateLimitDuration,
          GlobalWebRateLimitEnabled: settings.GlobalWebRateLimitEnabled,
          GlobalWebRateLimitNum: settings.GlobalWebRateLimitNum,
          GlobalWebRateLimitDuration: settings.GlobalWebRateLimitDuration,
          CriticalRateLimitEnabled: settings.CriticalRateLimitEnabled,
          CriticalRateLimitNum: settings.CriticalRateLimitNum,
          CriticalRateLimitDuration: settings.CriticalRateLimitDuration,
          UploadRateLimitEnabled: settings.UploadRateLimitEnabled,
          UploadRateLimitNum: settings.UploadRateLimitNum,
          UploadRateLimitDuration: settings.UploadRateLimitDuration,
          SearchRateLimitEnabled: settings.SearchRateLimitEnabled,
          SearchRateLimitNum: settings.SearchRateLimitNum,
          SearchRateLimitDuration: settings.SearchRateLimitDuration,
        }}
      />
    ),
  },
  {
    id: 'trusted-proxies',
    titleKey: 'Trusted Proxies',
    build: (settings: SecuritySettings) => (
      <TrustedProxySection
        defaultValues={{
          TrustedProxyCIDRs: settings.TrustedProxyCIDRs,
          CloudflareProxyEnabled: settings.CloudflareProxyEnabled,
        }}
      />
    ),
  },
  {
    id: 'edge-protection',
    titleKey: 'Edge Protection',
    build: () => <EdgeProtectionSection />,
  },
  {
    id: 'sensitive-words',
    titleKey: 'Sensitive Words',
    build: (settings: SecuritySettings) => (
      <SensitiveWordsSection
        defaultValues={{
          CheckSensitiveEnabled: settings.CheckSensitiveEnabled,
          CheckSensitiveOnPromptEnabled: settings.CheckSensitiveOnPromptEnabled,
          SensitiveWords: settings.SensitiveWords,
        }}
      />
    ),
  },
  {
    id: 'ssrf',
    titleKey: 'SSRF Protection',
    build: (settings: SecuritySettings) => (
      <SSRFSection
        defaultValues={{
          'fetch_setting.enable_ssrf_protection':
            settings['fetch_setting.enable_ssrf_protection'],
          'fetch_setting.allow_private_ip':
            settings['fetch_setting.allow_private_ip'],
          'fetch_setting.domain_filter_mode':
            settings['fetch_setting.domain_filter_mode'],
          'fetch_setting.ip_filter_mode':
            settings['fetch_setting.ip_filter_mode'],
          'fetch_setting.domain_list': settings['fetch_setting.domain_list'],
          'fetch_setting.ip_list': settings['fetch_setting.ip_list'],
          'fetch_setting.allowed_ports':
            settings['fetch_setting.allowed_ports'],
          'fetch_setting.apply_ip_filter_for_domain':
            settings['fetch_setting.apply_ip_filter_for_domain'],
        }}
      />
    ),
  },
  {
    id: 'token-limits',
    titleKey: 'Token Limits',
    build: (settings: SecuritySettings) => (
      <TokenLimitSection
        defaultValues={{
          'token_setting.max_user_tokens':
            settings['token_setting.max_user_tokens'],
        }}
      />
    ),
  },
] as const

const securityRegistry = createSectionRegistry<
  SecuritySectionId,
  SecuritySettings
>({
  sectionIds: SECURITY_SECTION_IDS,
  sections: SECURITY_SECTIONS,
  defaultSection: SECURITY_DEFAULT_SECTION,
  basePath: '/system-settings/security',
  urlStyle: 'path',
})

export const getSecuritySectionNavItems = securityRegistry.getSectionNavItems
export const getSecuritySectionContent = securityRegistry.getSectionContent
export const getSecuritySectionMeta = securityRegistry.getSectionMeta
