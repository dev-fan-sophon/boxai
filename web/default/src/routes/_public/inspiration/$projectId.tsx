import { createFileRoute, redirect, useParams } from '@tanstack/react-router'

import { WorkbenchEditor } from '@/features/workbench'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_public/inspiration/$projectId')({
  beforeLoad: ({ location }) => {
    if (useAuthStore.getState().auth.user) return
    throw redirect({ to: '/sign-in', search: { redirect: location.href } })
  },
  component: InspirationProjectPage,
})

function InspirationProjectPage() {
  const { projectId } = useParams({ from: '/_public/inspiration/$projectId' })

  return (
    <div className='min-h-0 flex-1'>
      <WorkbenchEditor projectId={Number(projectId)} />
    </div>
  )
}
