import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { Billing } from '@/features/billing'

// `pay` is set by gateway return URLs; `show_history` is kept for the legacy
// /console/topup and Waffo return links, and now scrolls to the history block.
const billingSearchSchema = z.object({
  show_history: z.boolean().optional(),
  pay: z.enum(['success', 'fail', 'pending']).optional(),
})

export const Route = createFileRoute('/_authenticated/billing/')({
  component: RouteComponent,
  validateSearch: billingSearchSchema,
})

function RouteComponent() {
  const { show_history, pay } = Route.useSearch()
  return <Billing initialShowHistory={show_history} paymentResult={pay} />
}
