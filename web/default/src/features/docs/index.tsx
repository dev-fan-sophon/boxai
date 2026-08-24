import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { FileQuestion } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { getIntegrationProfiles } from '@/features/pricing/api'

import { DocsArticlePage } from './article'
import { DocsShell } from './docs-shell'
import { DocsHomePage } from './home'
import { loadDocsPage, normalizeDocsPath } from './lib/load-doc'
import { resolveDocsLegacyPath } from './lib/redirects'
import { DocsProtocolPage } from './protocol-page'

export { REPRESENTATIVE_MODEL } from './lib/load-doc'
export { PROFILE_NOTES } from './profile-notes'

export function DocsPage(props: { docPath?: string }) {
  const { t, i18n } = useTranslation()
  const raw = (props.docPath || '').trim()
  const normalized = raw ? normalizeDocsPath(raw) : ''
  const legacyTarget = normalized ? resolveDocsLegacyPath(normalized) : null
  const guide =
    normalized && !legacyTarget ? loadDocsPage(normalized, i18n.language) : null

  const needsProfiles = Boolean(normalized && !legacyTarget && !guide)
  const profilesQuery = useQuery({
    queryKey: ['integration-profiles'],
    queryFn: getIntegrationProfiles,
    staleTime: 5 * 60 * 1000,
    enabled: needsProfiles,
  })

  if (!raw) {
    return <DocsHomePage />
  }

  if (legacyTarget) {
    return (
      <DocsShell activePath={normalized}>
        <EmptyState
          icon={FileQuestion}
          title={t('Page moved')}
          description={t('This documentation URL has a new location.')}
          action={
            <Link
              to='/docs/$'
              params={{ _splat: legacyTarget }}
              className='text-primary inline-block hover:underline'
            >
              {t('Go to the new page')}
            </Link>
          }
        />
      </DocsShell>
    )
  }

  if (guide) {
    return <DocsArticlePage docPath={normalized} />
  }

  if (profilesQuery.isPending) {
    return (
      <DocsShell activePath={normalized}>
        <div className='space-y-4'>
          <Skeleton className='h-9 w-2/3' />
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-4 w-11/12' />
          <Skeleton className='h-64 w-full rounded-xl' />
        </div>
      </DocsShell>
    )
  }

  if (profilesQuery.isError) {
    return (
      <DocsShell activePath={normalized}>
        <ErrorState
          className='border border-dashed'
          title={t('Loading failed')}
        />
      </DocsShell>
    )
  }

  const profiles = profilesQuery.data ?? []
  const apiSlug = normalized.startsWith('api/')
    ? normalized.slice('api/'.length)
    : normalized
  const profile = profiles.find((item) => item.docs_slug === apiSlug)
  if (profile) {
    return (
      <DocsProtocolPage
        profile={profile}
        docPath={normalized.startsWith('api/') ? normalized : `api/${apiSlug}`}
      />
    )
  }

  return (
    <DocsShell activePath={normalized}>
      <EmptyState
        icon={FileQuestion}
        title={t('Documentation page not found')}
        description={t(
          'The requested documentation page does not exist or is no longer available.'
        )}
        action={
          <Link
            to='/docs/$'
            params={{ _splat: 'start/getting-started' }}
            className='text-primary inline-block hover:underline'
          >
            {t('Go to getting started')}
          </Link>
        }
      />
    </DocsShell>
  )
}
