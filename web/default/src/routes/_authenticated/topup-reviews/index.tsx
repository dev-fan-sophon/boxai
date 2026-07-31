import { createFileRoute, redirect } from '@tanstack/react-router'

import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Legacy path. Commerce lives under Pricing Center → Top-up Reviews.
 */
export const Route = createFileRoute('/_authenticated/topup-reviews/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }
    throw redirect({
      to: '/pricing-center/$tab',
      params: { tab: 'topup-reviews' },
    })
  },
})
