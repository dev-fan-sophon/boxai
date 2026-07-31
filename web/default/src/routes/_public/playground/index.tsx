import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { PublicLayout } from '@/components/layout'
import { Playground } from '@/features/playground'
import { getFreshModuleAccess } from '@/lib/nav-modules'

export const Route = createFileRoute('/_public/playground/')({
  validateSearch: z.object({
    model: z.string().trim().min(1).max(128).optional(),
  }),
  beforeLoad: async () => {
    const access = await getFreshModuleAccess('playground')
    if (!access.enabled) throw redirect({ to: '/' })
  },
  component: PlaygroundPage,
})

function PlaygroundPage() {
  return (
    <PublicLayout showMainContainer={false}>
      <div className='playground-page h-dvh max-h-dvh overflow-hidden pt-[calc(var(--app-header-height,3.5rem)+env(safe-area-inset-top,0px))]'>
        <Playground />
      </div>
    </PublicLayout>
  )
}
