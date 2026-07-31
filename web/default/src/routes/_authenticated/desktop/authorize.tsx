import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { DesktopAuthorizationPage } from '@/features/desktop-authorization'

export const Route = createFileRoute('/_authenticated/desktop/authorize')({
  validateSearch: z.object({
    request: z.string().trim().min(1).optional().catch(undefined),
  }),
  component: DesktopAuthorizationPage,
})
