import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { PublicLayout } from '@/components/layout'
import { CreateLayout } from '@/features/create'
import { getFreshModuleAccess } from '@/lib/nav-modules'

export const Route = createFileRoute('/_public/studio')({
  beforeLoad: async () => {
    const access = await getFreshModuleAccess('create')
    if (!access.enabled) throw redirect({ to: '/' })
  },
  component: CreateRouteLayout,
})

function CreateRouteLayout() {
  return (
    <PublicLayout showMainContainer={false}>
      <div className='playground-page h-dvh max-h-dvh overflow-hidden pt-[calc(var(--app-header-height,3.5rem)+env(safe-area-inset-top,0px))]'>
        <CreateLayout>
          <Outlet />
        </CreateLayout>
      </div>
    </PublicLayout>
  )
}
