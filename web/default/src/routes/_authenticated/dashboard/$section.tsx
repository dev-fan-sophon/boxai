import { createFileRoute, redirect } from '@tanstack/react-router'

import { Dashboard } from '@/features/dashboard'
import {
  DASHBOARD_SECTION_IDS,
  DASHBOARD_DEFAULT_SECTION,
} from '@/features/dashboard/section-manifest'

export const Route = createFileRoute('/_authenticated/dashboard/$section')({
  beforeLoad: ({ params }) => {
    const validSections = DASHBOARD_SECTION_IDS as unknown as string[]
    if (!validSections.includes(params.section)) {
      throw redirect({
        to: '/dashboard/$section',
        params: { section: DASHBOARD_DEFAULT_SECTION },
      })
    }
    // Console dashboard is personal: multi-user analytics live under /admin/analytics.
    if (params.section === 'users' || params.section === 'flow') {
      throw redirect({
        to: '/dashboard/$section',
        params: { section: 'models' },
      })
    }
  },
  component: () => <Dashboard scope='self' />,
})
