import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import { InspirationHome } from '@/features/inspiration/components/inspiration-home'

export const Route = createFileRoute('/_public/inspiration/')({
  validateSearch: z.object({
    view: z.enum(['templates', 'projects']).optional(),
  }),
  component: InspirationIndexPage,
})

function InspirationIndexPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()

  return (
    <div className='min-h-0 flex-1 overflow-y-auto'>
      <InspirationHome
        view={search.view ?? 'templates'}
        onViewChange={(view) =>
          void navigate({ to: '/inspiration', search: { view } })
        }
      />
    </div>
  )
}
