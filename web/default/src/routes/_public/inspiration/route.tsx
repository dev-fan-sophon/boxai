import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { PublicLayout } from '@/components/layout'
import { getFreshModuleAccess } from '@/lib/nav-modules'

/**
 * Inspiration runs on the marketing-site shell, not the console shell: it is a
 * public-facing product surface, and the canvas needs the whole viewport.
 */
export const Route = createFileRoute('/_public/inspiration')({
  beforeLoad: async () => {
    const access = await getFreshModuleAccess('inspiration')
    if (!access.enabled) throw redirect({ to: '/' })
  },
  component: InspirationLayout,
})

function InspirationLayout() {
  return (
    <PublicLayout showMainContainer={false}>
      {/* pt-16 matches the unscrolled PublicHeader, which floats over content. */}
      <div className='flex h-dvh max-h-dvh flex-col overflow-hidden pt-16'>
        <Outlet />
      </div>
    </PublicLayout>
  )
}
