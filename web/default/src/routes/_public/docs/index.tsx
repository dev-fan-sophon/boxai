import { createFileRoute } from '@tanstack/react-router'

import { DocsPage } from '@/features/docs'

export const Route = createFileRoute('/_public/docs/')({
  component: DocsHomeRoute,
})

function DocsHomeRoute() {
  return <DocsPage />
}
