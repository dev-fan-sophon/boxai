import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

import { updateCloudflareDNSProxy, type CloudflareDNSRecord } from './api'
import { useCloudflareMutation } from './use-cloudflare'

type DnsProxyCardProps = {
  records: CloudflareDNSRecord[]
}

export function DnsProxyCard(props: DnsProxyCardProps) {
  const { t } = useTranslation()
  const setProxied = useCloudflareMutation(
    updateCloudflareDNSProxy,
    t('DNS record updated')
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Proxied hostnames')}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        <p className='text-muted-foreground text-sm'>
          {t(
            'A hostname only receives edge caching, WAF rules and DDoS mitigation while it is proxied. An unproxied record resolves straight to the origin address, which is then reachable and attackable directly.'
          )}
        </p>
        <div className='divide-y rounded-lg border'>
          {props.records.map((record) => (
            <div
              key={record.id}
              className='flex items-center justify-between gap-4 p-3'
            >
              <div className='flex min-w-0 flex-col'>
                <span className='truncate font-mono text-sm'>
                  {record.name}
                </span>
                <div className='mt-1 flex items-center gap-2'>
                  <Badge variant='secondary'>{record.type}</Badge>
                  {record.proxied ? null : (
                    <span className='text-muted-foreground text-xs'>
                      {t('Origin exposed')}
                    </span>
                  )}
                </div>
              </div>
              <Switch
                checked={record.proxied}
                disabled={setProxied.isPending}
                onCheckedChange={(checked) =>
                  setProxied.mutate({ record_id: record.id, proxied: checked })
                }
                aria-label={t('Proxy through Cloudflare')}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
