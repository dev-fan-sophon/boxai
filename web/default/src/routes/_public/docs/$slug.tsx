import { createFileRoute } from '@tanstack/react-router'

import { DocsPage } from '@/features/docs'

export const Route = createFileRoute('/_public/docs/$slug')({
  component: RouteComponent,
})
function RouteComponent() {
  const { slug } = Route.useParams()
  return <DocsPage slug={slug} />
}
