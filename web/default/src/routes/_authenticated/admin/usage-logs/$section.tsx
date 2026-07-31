import { createFileRoute, redirect } from '@tanstack/react-router'

import { UsageLogs } from '@/features/usage-logs'
import {
  isUsageLogsSectionId,
  USAGE_LOGS_DEFAULT_SECTION,
} from '@/features/usage-logs/section-manifest'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { usageLogsSearchSchema } from '../../usage-logs/$section'

function SiteUsageLogsPage() {
  const { section } = Route.useParams()
  const searchParams = Route.useSearch()
  return <UsageLogs mode='site' section={section} searchParams={searchParams} />
}

export const Route = createFileRoute(
  '/_authenticated/admin/usage-logs/$section'
)({
  beforeLoad: ({ params, search }) => {
    const { auth } = useAuthStore.getState()
    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }

    if (!isUsageLogsSectionId(params.section)) {
      throw redirect({
        to: '/admin/usage-logs/$section',
        params: { section: USAGE_LOGS_DEFAULT_SECTION },
      })
    }

    const hasTypeSearch = Array.isArray(search?.type)
      ? search.type.length > 0
      : search?.type != null && search.type !== ''
    if (params.section !== 'common' && hasTypeSearch) {
      throw redirect({
        to: '/admin/usage-logs/$section',
        params: { section: params.section },
        search: { ...search, type: undefined },
        replace: true,
      })
    }
  },
  validateSearch: usageLogsSearchSchema,
  component: SiteUsageLogsPage,
})
