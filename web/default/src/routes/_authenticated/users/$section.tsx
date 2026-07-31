import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { Users } from '@/features/users'
import {
  USERS_DEFAULT_SECTION,
  USERS_SECTION_IDS,
} from '@/features/users/section-manifest'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

const USER_SECTIONS = USERS_SECTION_IDS as readonly string[]

const usersSearchSchema = z.object({
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(undefined),
  filter: z.string().optional().catch(''),
  status: z
    .array(z.enum(['-1', '1', '2']))
    .optional()
    .catch([]),
  role: z
    .array(z.enum(['1', '10', '100']))
    .optional()
    .catch([]),
  group: z.string().optional().catch(''),
})

export const Route = createFileRoute('/_authenticated/users/$section')({
  beforeLoad: ({ params }) => {
    const { auth } = useAuthStore.getState()

    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }

    if (!USER_SECTIONS.includes(params.section)) {
      throw redirect({
        to: '/users/$section',
        params: { section: USERS_DEFAULT_SECTION },
      })
    }
  },
  validateSearch: usersSearchSchema,
  component: Users,
})
