/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
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
