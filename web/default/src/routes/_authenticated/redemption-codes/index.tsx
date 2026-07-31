import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { REDEMPTION_FILTER_VALUES } from '@/features/redemption-codes/constants'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

const redemptionsSearchSchema = z.object({
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(10),
  filter: z.string().optional().catch(''),
  status: z.array(z.enum(REDEMPTION_FILTER_VALUES)).optional().catch([]),
})

/**
 * Legacy path. Commerce lives under Pricing Center → Redemption Codes.
 */
export const Route = createFileRoute('/_authenticated/redemption-codes/')({
  beforeLoad: ({ search }) => {
    const { auth } = useAuthStore.getState()
    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }
    throw redirect({
      to: '/pricing-center/$tab',
      params: { tab: 'redemption' },
      search,
    })
  },
  validateSearch: redemptionsSearchSchema,
})
