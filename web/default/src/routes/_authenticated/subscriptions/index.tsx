import { createFileRoute, redirect } from '@tanstack/react-router'

// Subscription plan management moved into the Pricing Center.
export const Route = createFileRoute('/_authenticated/subscriptions/')({
  beforeLoad: () => {
    throw redirect({
      to: '/pricing-center/$tab',
      params: { tab: 'subscriptions' },
    })
  },
})
