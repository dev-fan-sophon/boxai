import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { AuthorizationPage } from '@/features/desktop-authorization'

export const Route = createFileRoute('/_authenticated/connect/authorize')({
  validateSearch: z.object({
    request: z.string().trim().min(1).optional().catch(undefined),
  }),
  component: ConnectAuthorizationPage,
})

function ConnectAuthorizationPage() {
  const search = Route.useSearch()
  return <AuthorizationPage requestId={search.request} product='connect' />
}
