import { PageTransition } from '@/components/page-enter'

type PublicLayoutProps = {
  children: React.ReactNode
  showMainContainer?: boolean
}

/**
 * Page content wrapper for public routes. The shell and header belong to the
 * `/_public` layout route so they survive navigation between public pages.
 */
export function PublicLayout(props: PublicLayoutProps) {
  // Route-level entrance, so the marketing and full-viewport app shells fade in
  // the same way console pages already do through `AnimatedOutlet`.
  const content = <PageTransition>{props.children}</PageTransition>

  if (props.showMainContainer === false) return content

  return <main className='container px-4 py-6 pt-20 md:px-4'>{content}</main>
}
