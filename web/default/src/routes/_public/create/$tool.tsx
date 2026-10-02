import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { CreateToolPage } from '@/features/create'
import { isCreateTool } from '@/features/create/constants'

export const Route = createFileRoute('/_public/create/$tool')({
  validateSearch: z.object({
    model: z.string().trim().min(1).max(128).optional(),
  }),
  beforeLoad: ({ params }) => {
    if (!isCreateTool(params.tool)) {
      throw redirect({ to: '/create/$tool', params: { tool: 'image' } })
    }
  },
  component: CreateToolRoute,
})

function CreateToolRoute() {
  const params = Route.useParams()
  const search = Route.useSearch()
  if (!isCreateTool(params.tool)) return null
  return <CreateToolPage tool={params.tool} model={search.model} />
}
