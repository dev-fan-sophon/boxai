import { createFileRoute, redirect } from '@tanstack/react-router'

import { DocsPage } from '@/features/docs'
import { resolveDocsLegacyPath } from '@/features/docs/lib/redirects'

function splatFromParams(params: { _splat?: string }): string {
  return typeof params._splat === 'string' ? params._splat : ''
}

export const Route = createFileRoute('/_public/docs/$')({
  beforeLoad: ({ params }) => {
    const splat = splatFromParams(params)
    const legacy = resolveDocsLegacyPath(splat)
    if (legacy) {
      throw redirect({
        to: '/docs/$',
        params: { _splat: legacy },
        replace: true,
      })
    }
  },
  component: DocsSplatRoute,
})

function DocsSplatRoute() {
  const params = Route.useParams()
  return <DocsPage docPath={splatFromParams(params)} />
}
