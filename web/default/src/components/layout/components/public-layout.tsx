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
import { PageTransition } from '@/components/page-transition'

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
