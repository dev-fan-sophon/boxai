import { createFileRoute, redirect } from '@tanstack/react-router'

import { PublicLayout } from '@/components/layout'
import { AgentsView } from '@/features/agents'
import { getFreshModuleAccess } from '@/lib/nav-modules'

export const Route = createFileRoute('/_public/agents/')({
  beforeLoad: async () => {
    const access = await getFreshModuleAccess('agents')
    if (!access.enabled) throw redirect({ to: '/' })
  },
  component: AgentsPage,
})

function AgentsPage() {
  return (
    <PublicLayout showMainContainer={false}>
      <AgentsView />
    </PublicLayout>
  )
}
