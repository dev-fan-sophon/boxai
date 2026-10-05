import { createFileRoute } from '@tanstack/react-router'

import { CreateLibrary } from '@/features/create'

export const Route = createFileRoute('/_public/studio/library')({
  component: CreateLibrary,
})
