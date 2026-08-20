import { createFileRoute } from '@tanstack/react-router'

import { PublicRewardClaimPage } from '@/features/rewards/public-claim-page'

export const Route = createFileRoute('/_public/r/$slug')({
  component: PublicRewardClaimRoute,
})

function PublicRewardClaimRoute() {
  const { slug } = Route.useParams()
  return <PublicRewardClaimPage slug={slug} />
}
