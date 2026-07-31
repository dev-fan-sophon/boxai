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
                ruleActions={status.rule_actions ?? []}
                zoneName={status.zone_name ?? ''}
              />
            </>
          ) : null}
        </div>
      )}
    </SettingsSection>
  )
}
