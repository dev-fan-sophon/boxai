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
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

import { SettingsSection } from '../components/settings-section'
import { CredentialsCard } from './credentials-card'
import { DnsProxyCard } from './dns-proxy-card'
import { ProtectionRulesCard } from './protection-rules-card'
import { useCloudflareStatus } from './use-cloudflare'
import { ZoneSettingsCard } from './zone-settings-card'

export function EdgeProtectionSection() {
  const { t } = useTranslation()
  const statusQuery = useCloudflareStatus()

  const status = statusQuery.data?.data
  const configured = status?.configured ?? false

  return (
    <SettingsSection title={t('Edge Protection')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Manages the Cloudflare zone in front of this deployment. Changes here are written straight to Cloudflare and take effect at the edge within seconds.'
        )}
      </p>

      {statusQuery.isPending ? (
        <Skeleton className='h-40 w-full' />
      ) : (
        <div className='flex flex-col gap-4'>
          {configured && status ? (
            <div className='flex flex-wrap items-center gap-2'>
              <span className='font-mono text-sm'>{status.zone_name}</span>
              <Badge variant='secondary'>{status.plan}</Badge>
            </div>
          ) : null}

          <CredentialsCard
            zoneId={status?.zone_id ?? ''}
            accountId={status?.account_id ?? ''}
          />

          {configured && status ? (
            <>
              <DnsProxyCard records={status.dns_records ?? []} />
              <ZoneSettingsCard
                settings={status.zone_settings ?? {}}
                bot={status.bot}
              />
              <ProtectionRulesCard
                rateLimitRules={status.rate_limit_rules ?? []}
                firewallRules={status.firewall_rules ?? []}
                credentialEndpoints={status.credential_endpoints ?? []}
                ratePeriods={status.rate_periods ?? []}
                zoneName={status.zone_name ?? ''}
              />
            </>
          ) : null}
        </div>
      )}
    </SettingsSection>
  )
}
