import { createFileRoute, redirect } from '@tanstack/react-router'

// Keep bookmarks and model deep links working without mounting the old workspace.
export const Route = createFileRoute('/_public/create')({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `/studio${location.pathname.slice('/create'.length)}${location.searchStr}${location.hash ? `#${location.hash}` : ''}`,
      replace: true,
    })
  },
})
