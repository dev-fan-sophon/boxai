import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { PricingCenter } from '@/features/pricing-center'
import {
  canAccessPricingCenterTab,
  defaultPricingCenterTab,
  isPricingCenterTab,
} from '@/features/pricing-center/tabs'
import { REDEMPTION_FILTER_VALUES } from '@/features/redemption-codes/constants'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/pricing-center/$tab')({
  validateSearch: z.object({
    model: z.string().optional(),
    page: z.number().optional().catch(1),
    pageSize: z.number().optional().catch(10),
    filter: z.string().optional().catch(''),
    status: z.array(z.enum(REDEMPTION_FILTER_VALUES)).optional().catch([]),
  }),
  beforeLoad: ({ params }) => {
    const role = useAuthStore.getState().auth.user?.role
    if (role === undefined || role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }

    if (!isPricingCenterTab(params.tab)) {
      throw redirect({
        to: '/pricing-center/$tab',
        params: { tab: defaultPricingCenterTab(role) },
      })
    }

    if (!canAccessPricingCenterTab(params.tab, role)) {
      throw redirect({
        to: '/pricing-center/$tab',
        params: { tab: defaultPricingCenterTab(role) },
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
    : defaultPricingCenterTab(useAuthStore.getState().auth.user?.role)
  return <PricingCenter tab={tab} initialModelFilter={search.model} />
}
