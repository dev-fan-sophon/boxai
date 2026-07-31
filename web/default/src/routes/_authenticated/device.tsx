import { createFileRoute } from '@tanstack/react-router'
import z from 'zod'

import { DeviceAuthorizePage } from '@/features/device-auth'

const deviceSearchSchema = z.object({
  code: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/device')({
  validateSearch: deviceSearchSchema,
  component: DeviceAuthorizePage,
})
