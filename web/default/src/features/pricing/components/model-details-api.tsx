import { Link } from '@tanstack/react-router'
import {
  CheckCircle2,
  CircleSlash2,
  ExternalLink,
  PlugZap,
  ShieldCheck,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BundledLanguage } from 'shiki/bundle/web'

import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  buildIntegrationSample,
  integrationPath,
  type SampleLanguage,
} from '@/features/integrations/sample-builder'
import { useStatus } from '@/hooks/use-status'

import {
  getModelEndpointIntegrations,
  resolveGatewayBaseUrl,
} from '../lib/model-agent-guide'
import type { IntegrationProfile, PricingModel } from '../types'

const LANGUAGES: Array<{
  value: SampleLanguage
  label: string
  syntax: BundledLanguage
}> = [
  { value: 'curl', label: 'cURL', syntax: 'bash' },
  { value: 'python', label: 'Python', syntax: 'python' },
  { value: 'typescript', label: 'TypeScript', syntax: 'typescript' },
  { value: 'javascript', label: 'JavaScript', syntax: 'javascript' },
]

export function ModelDetailsApi(props: {
  model: PricingModel
  endpointMap: Record<string, { path?: string; method?: string }>
  integrationProfiles: IntegrationProfile[]
}) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const integrations = useMemo(
    () => getModelEndpointIntegrations(props.model, props.integrationProfiles),
    [props.integrationProfiles, props.model]
  )
  const [endpointType, setEndpointType] = useState(
    integrations[0]?.endpointType ?? ''
  )
  const [language, setLanguage] = useState<SampleLanguage>('curl')
  const selected =
    integrations.find((item) => item.endpointType === endpointType) ??
    integrations[0]

  if (!selected) {
    return (
      <EmptyState
        icon={PlugZap}
        className='min-h-[180px]'
        title={t('No supported endpoints are available for this model')}
        action={
          <Link
            to='/docs/$'
            params={{ _splat: 'start/getting-started' }}
            className='text-primary inline-flex items-center gap-1 text-sm hover:underline'
          >
            {t('View getting started guide')}{' '}
            <ExternalLink className='size-3.5' />
          </Link>
        }
      />
    )
  }

  const baseUrl = resolveGatewayBaseUrl(
    status,
    typeof window !== 'undefined' ? window.location.origin : ''
  )
  const languageMeta =
    LANGUAGES.find((item) => item.value === language) ?? LANGUAGES[0]
  const profile = selected.profile
  const sample = profile
    ? buildIntegrationSample(profile, props.model.model_name, language, baseUrl)
    : ''
  const endpointInfo = props.endpointMap[selected.endpointType]
  let supportBadge = (
    <Badge variant='secondary' className='gap-1'>
      <CheckCircle2 className='size-3' />
      {t('Compatibility inferred')}
    </Badge>
  )
  if (!profile) {
    supportBadge = (
      <Badge variant='outline' className='gap-1'>
        <CircleSlash2 className='size-3' />
        {t('Unavailable')}
      </Badge>
    )
  } else if (selected.integration.verified) {
    supportBadge = (
      <Badge className='gap-1'>
        <ShieldCheck className='size-3' />
        {t('Verified')}
      </Badge>
    )
  }

  return (
    <div className='space-y-5'>
      <div className='flex flex-wrap items-center gap-2'>
        <Tabs value={selected.endpointType} onValueChange={setEndpointType}>
          <TabsList className='h-auto flex-wrap'>
            {integrations.map((item) => (
              <TabsTrigger key={item.endpointType} value={item.endpointType}>
                {item.profile ? t(item.profile.name_key) : item.endpointType}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {supportBadge}
      </div>

      {profile ? (
        <>
          <dl className='grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2'>
            <div>
              <dt className='text-muted-foreground'>{t('Protocol')}</dt>
              <dd>{profile.protocol}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t('Route')}</dt>
              <dd className='font-mono text-xs'>
                {profile.method}{' '}
                {integrationPath(profile, props.model.model_name)}
              </dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t('Authentication')}</dt>
              <dd>{profile.auth_scheme}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t('Streaming')}</dt>
              <dd>{profile.streaming ? t('Supported') : t('Not supported')}</dd>
            </div>
            <div className='sm:col-span-2'>
              <dt className='text-muted-foreground'>{t('Group scope')}</dt>
              <dd>
                {selected.integration.groups.length > 0
                  ? selected.integration.groups.join(', ')
                  : t('All available groups')}
              </dd>
            </div>
          </dl>

          <div className='flex flex-wrap items-center justify-between gap-2'>
            <Tabs
              value={language}
              onValueChange={(value) => setLanguage(value as SampleLanguage)}
            >
              <TabsList>
                {LANGUAGES.map((item) => (
                  <TabsTrigger key={item.value} value={item.value}>
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Link
              to='/docs/$'
              params={{ _splat: `api/${profile.docs_slug}` }}
              className='text-primary inline-flex items-center gap-1 text-sm hover:underline'
            >
              {t('Full integration guide')}{' '}
              <ExternalLink className='size-3.5' />
            </Link>
          </div>
          <CodeBlock code={sample} language={languageMeta.syntax}>
            <CodeBlockCopyButton />
          </CodeBlock>
        </>
      ) : (
        <>
          <dl className='grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2'>
            <div>
              <dt className='text-muted-foreground'>{t('Endpoint type')}</dt>
              <dd className='font-mono text-xs'>{selected.endpointType}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t('Route')}</dt>
              <dd className='font-mono text-xs'>
                {endpointInfo?.path
                  ? `${endpointInfo.method ?? 'POST'} ${endpointInfo.path}`
                  : t('Unavailable')}
              </dd>
            </div>
          </dl>
          <EmptyState
            icon={CircleSlash2}
            className='min-h-[160px]'
            title={t('Integration guide unavailable for this endpoint')}
          />
        </>
      )}
    </div>
  )
}
