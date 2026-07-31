import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { PricingCenter } from '@/features/pricing-center'
import {
  PRICING_CENTER_DEFAULT_TAB,
  isPricingCenterTab,
} from '@/features/pricing-center/tabs'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/pricing-center/$tab')({
  validateSearch: z.object({ model: z.string().optional() }),
  beforeLoad: ({ params }) => {
    if (useAuthStore.getState().auth.user?.role !== ROLE.SUPER_ADMIN) {
      throw redirect({ to: '/403' })
    }
    if (!isPricingCenterTab(params.tab)) {
      throw redirect({
        to: '/pricing-center/$tab',
        params: { tab: PRICING_CENTER_DEFAULT_TAB },
      })
    }
  },
  component: PricingCenterRoute,
})

function PricingCenterRoute() {
  const search = Route.useSearch()
  const params = Route.useParams()
  const tab = isPricingCenterTab(params.tab)
    ? params.tab
    : PRICING_CENTER_DEFAULT_TAB
  return <PricingCenter tab={tab} initialModelFilter={search.model} />
}
