import { createFileRoute } from '@tanstack/react-router'

import { RewardsPage } from '@/features/rewards'

export const Route = createFileRoute('/_authenticated/rewards/')({
  component: RewardsPage,
})
