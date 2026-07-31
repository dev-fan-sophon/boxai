import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { PRICING_CENTER_DEFAULT_TAB } from '@/features/pricing-center/tabs'

export const Route = createFileRoute('/_authenticated/pricing-center/')({
  validateSearch: z.object({ model: z.string().optional() }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/pricing-center/$tab',
      params: { tab: PRICING_CENTER_DEFAULT_TAB },
      search,
    })
  },
})
