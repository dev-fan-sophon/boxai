import { createFileRoute, redirect } from '@tanstack/react-router'

import { useCreateStore } from '@/stores/create-store'

// /studio opens the tool the user worked in last.
export const Route = createFileRoute('/_public/studio/')({
  beforeLoad: ({ location }) => {
    throw redirect({
      to: '/studio/$tool',
      params: { tool: useCreateStore.getState().lastTool },
      search: true,
      hash: location.hash,
      replace: true,
    })
  },
})
