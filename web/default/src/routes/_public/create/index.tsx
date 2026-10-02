import { createFileRoute, redirect } from '@tanstack/react-router'

import { useCreateStore } from '@/stores/create-store'

// /create opens the tool the user worked in last.
export const Route = createFileRoute('/_public/create/')({
  beforeLoad: () => {
    throw redirect({
      to: '/create/$tool',
      params: { tool: useCreateStore.getState().lastTool },
      replace: true,
    })
  },
})
