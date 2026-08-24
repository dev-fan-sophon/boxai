import { createFileRoute } from '@tanstack/react-router'

import { ConnectView } from '@/features/connect'

export const Route = createFileRoute('/_public/connect/')({
  component: ConnectView,
})
