import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BundledLanguage } from 'shiki/bundle/web'

import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  buildIntegrationSample,
  integrationPath,
  type SampleLanguage,
} from '@/features/integrations/sample-builder'
import type { IntegrationProfile } from '@/features/pricing/types'
import { useSeo } from '@/hooks/use-page-seo'
import { useStatus } from '@/hooks/use-status'

import { DocsShell } from './docs-shell'
import { REPRESENTATIVE_MODEL } from './lib/load-doc'
import { PROFILE_NOTES } from './profile-notes'

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

export function DocsProtocolPage(props: {
  profile: IntegrationProfile
  docPath: string
}) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const [language, setLanguage] = useState<SampleLanguage>('curl')
  const languageMeta = LANGUAGES.find((item) => item.value === language) ?? {
    value: 'curl' as const,
    label: 'cURL',
    syntax: 'bash' as const,
  }
  const statusRecord = status as Record<string, unknown> | null
  const baseUrl =
    (typeof statusRecord?.server_address === 'string' &&
      statusRecord.server_address.replace(/\/$/, '')) ||
    (typeof window !== 'undefined' ? window.location.origin : '')
  const sample = buildIntegrationSample(
    props.profile,
    REPRESENTATIVE_MODEL,
    language,
    baseUrl
  )
  const authHeader =
    props.profile.auth_scheme === 'x-api-key'
      ? 'x-api-key'
      : 'Authorization: Bearer'
  const title = t(props.profile.name_key)

  useSeo(
    useMemo(
      () => ({
        title,
        description: t(
          'API documentation for {{name}} on the unified AI gateway.',
          { name: title }
        ),
      }),
      [t, title]
    )
  )

  return (
    <DocsShell activePath={props.docPath}>
      <h1 className='text-3xl font-bold tracking-tight'>{title}</h1>
      <p className='text-muted-foreground mt-3'>
        {t(
          'Use this gateway integration profile with an exact model ID from Model Hub.'
        )}
      </p>
      <div className='mt-6 rounded-lg border p-4 text-sm'>
        <p>
          {t(
            'These examples call the BoxAI gateway, not an upstream provider. Model availability depends on your group; check Model Hub before integrating.'
          )}
        </p>
        <div className='mt-2 flex flex-wrap gap-4'>
          <Link to='/pricing' className='text-primary hover:underline'>
            {t('Browse Model Hub')}
          </Link>
          <Link
            to='/docs/$'
            params={{ _splat: 'api/overview' }}
            className='text-primary hover:underline'
          >
            {t('API overview')}
          </Link>
        </div>
      </div>
      <dl className='mt-6 grid gap-4 rounded-lg border p-4 text-sm sm:grid-cols-2'>
        {[
          [t('Method'), props.profile.method],
          [
            t('Gateway route'),
            integrationPath(props.profile, REPRESENTATIVE_MODEL),
          ],
          [t('Authentication header'), authHeader],
          [t('Content type'), props.profile.content_type],
          [
            t('Streaming support'),
            props.profile.streaming ? t('Supported') : t('Not supported'),
          ],
          [t('Model placeholder'), REPRESENTATIVE_MODEL],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='mt-1 font-mono text-xs'>{value}</dd>
          </div>
        ))}
      </dl>
      <section className='mt-8 space-y-3'>
        <h2 className='text-xl font-semibold'>{t('Protocol notes')}</h2>
        {(PROFILE_NOTES[props.profile.sample_kind] ?? []).map((note) => (
          <p key={note} className='text-muted-foreground'>
            {t(note)}
          </p>
        ))}
      </section>
      <div className='mt-8'>
        <Tabs
          value={language}
          onValueChange={(value) => setLanguage(value as SampleLanguage)}
        >
          <TabsList className='mb-3 flex-wrap'>
            {LANGUAGES.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <CodeBlock code={sample} language={languageMeta.syntax}>
          <CodeBlockCopyButton />
        </CodeBlock>
      </div>
    </DocsShell>
  )
}
