import { createFileRoute, Outlet } from '@tanstack/react-router'

import { PublicHeader } from '@/components/layout'

// The header lives on the layout route so it keeps a single instance across
// public navigations; remounting it per page replayed the scroll-collapse
// animation and re-measured the nav on every route change.
function PublicRouteLayout() {
  return (
    <div className='bg-background text-foreground relative min-h-svh overflow-x-clip'>
      <PublicHeader />
      <Outlet />
    </div>
  )
}

export const Route = createFileRoute('/_public')({
  component: PublicRouteLayout,
})
