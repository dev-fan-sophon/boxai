import { createFileRoute } from '@tanstack/react-router'

import { UserAgreement } from '@/features/legal'

export const Route = createFileRoute('/_public/user-agreement')({
  component: UserAgreement,
})
