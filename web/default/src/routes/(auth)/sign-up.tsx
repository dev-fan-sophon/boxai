import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { SignUp } from '@/features/auth/sign-up'
import { normalizeReturnTarget } from '@/lib/normalize-return-target'
import { useAuthStore } from '@/stores/auth-store'

const searchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/(auth)/sign-up')({
  component: SignUp,
  validateSearch: searchSchema,
  beforeLoad: async ({ search }) => {
    const { auth } = useAuthStore.getState()

    if (auth.user) {
      throw redirect({ to: normalizeReturnTarget(search?.redirect) })
    }
  },
})
