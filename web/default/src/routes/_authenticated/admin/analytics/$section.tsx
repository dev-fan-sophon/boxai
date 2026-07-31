import { createFileRoute, redirect } from '@tanstack/react-router'

import { Dashboard } from '@/features/dashboard'
import { DASHBOARD_ANALYTICS_SECTION_IDS } from '@/features/dashboard/section-manifest'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

const SITE_ANALYTICS_SECTIONS =
  DASHBOARD_ANALYTICS_SECTION_IDS as readonly string[]

export const Route = createFileRoute(
  '/_authenticated/admin/analytics/$section'
)({
  beforeLoad: ({ params }) => {
    const { auth } = useAuthStore.getState()
    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }

    if (!SITE_ANALYTICS_SECTIONS.includes(params.section)) {
      throw redirect({
        to: '/admin/analytics/$section',
        params: { section: 'models' },
      })
    }
  },
  component: () => <Dashboard scope='site' />,
})
