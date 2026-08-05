import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Short alias `/doc` → product docs getting-started.
 * Keeps a stable entry for typed/shared links that omit the trailing `s`.
 */
export const Route = createFileRoute('/_public/doc')({
  beforeLoad: () => {
    throw redirect({
      to: '/docs/$',
      params: { _splat: 'start/getting-started' },
      replace: true,
    })
  },
})
