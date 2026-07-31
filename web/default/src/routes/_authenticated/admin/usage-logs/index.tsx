import { createFileRoute, redirect } from '@tanstack/react-router'

import { USAGE_LOGS_DEFAULT_SECTION } from '@/features/usage-logs/section-manifest'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/admin/usage-logs/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }
    throw redirect({
      to: '/admin/usage-logs/$section',
      params: { section: USAGE_LOGS_DEFAULT_SECTION },
    })
  },
})
