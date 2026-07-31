import { createFileRoute, redirect } from '@tanstack/react-router'

import { defaultPricingCenterTab } from '@/features/pricing-center/tabs'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/pricing-center/')({
  beforeLoad: () => {
    const role = useAuthStore.getState().auth.user?.role
    if (role === undefined || role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }
    throw redirect({
      to: '/pricing-center/$tab',
      params: { tab: defaultPricingCenterTab(role) },
    })
  },
})
