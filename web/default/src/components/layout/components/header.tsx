import { SidebarTrigger } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

type HeaderProps = React.HTMLAttributes<HTMLElement>

export function Header({ className, children, ...props }: HeaderProps) {
  return (
    <header
      className={cn(
        // Brand chrome is navy in both light and dark — use sidebar tokens,
        // not page surface tokens (text-foreground / muted), for all ink.
        'bg-sidebar text-sidebar-foreground sticky top-0 z-40 h-[var(--app-header-height,3rem)] w-full shrink-0',
        // Ghost / icon controls (language, config, profile, sidebar trigger)
        // ship with light-surface hover styles; remap them onto the navy bar.
        '[&_[data-slot=button]]:text-sidebar-foreground',
        '[&_[data-slot=button]]:hover:bg-sidebar-accent [&_[data-slot=button]]:hover:text-sidebar-accent-foreground',
        '[&_[data-slot=button]]:aria-expanded:bg-sidebar-accent [&_[data-slot=button]]:aria-expanded:text-sidebar-accent-foreground',
        '[&_[data-slot=sidebar-trigger]]:text-sidebar-foreground',
        '[&_[data-slot=sidebar-trigger]]:hover:bg-sidebar-accent [&_[data-slot=sidebar-trigger]]:hover:text-sidebar-accent-foreground',
        className
      )}
      {...props}
    >
      <div className='flex h-full items-center gap-1.5 px-2 sm:gap-2 sm:px-3'>
        <SidebarTrigger variant='ghost' className='size-8' />
        {children}
      </div>
    </header>
  )
}
