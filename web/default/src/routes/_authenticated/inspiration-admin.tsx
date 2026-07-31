import { createFileRoute, redirect } from '@tanstack/react-router'

import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Legacy path. Template admin now lives under
 * System Settings → Console Content → Inspiration templates.
 *
 * Note: system settings is root-only, so regular admins who previously had
 * this page lose direct access (same gate as other system settings sections).
 */
export const Route = createFileRoute('/_authenticated/inspiration-admin')({
  beforeLoad: () => {
    const user = useAuthStore.getState().auth.user
    if (!user || user.role < ROLE.ADMIN) throw redirect({ to: '/403' })
    throw redirect({
      to: '/system-settings/content/$section',
      params: { section: 'inspiration' },
    })
  },
})
