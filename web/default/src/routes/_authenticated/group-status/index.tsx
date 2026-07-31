import { createFileRoute } from '@tanstack/react-router'

import { GroupStatusPage } from '@/features/group-status'

export const Route = createFileRoute('/_authenticated/group-status/')({
  component: GroupStatusPage,
})
