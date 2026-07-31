import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_public/docs/')({
  beforeLoad: () => {
    throw redirect({ to: '/docs/$slug', params: { slug: 'what-is-boxai' } })
  },
})
