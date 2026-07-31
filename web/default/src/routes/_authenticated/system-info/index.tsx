import { createFileRoute, redirect } from '@tanstack/react-router'

import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Legacy path. Cluster System Info now lives under
 * System Settings → Operations → System Info.
 */
export const Route = createFileRoute('/_authenticated/system-info/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if (auth.user?.role !== ROLE.SUPER_ADMIN) {
      throw redirect({ to: '/403' })
    }
    throw redirect({
      to: '/system-settings/operations/$section',
      params: { section: 'system-info' },
    })
  },
})
