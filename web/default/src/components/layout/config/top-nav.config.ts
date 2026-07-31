import type { TopNavLink } from '../types'

/**
 * Default public navigation links.
 *
 * Priority: Backend HeaderNavModules (via useTopNavLinks) > provided navLinks >
 * these defaults. Keep titles as English i18n source keys.
 */
export const defaultTopNavLinks: TopNavLink[] = [
  { title: 'Home', href: '/' },
  { title: 'Workspace', href: '/playground' },
  { title: 'Agents', href: '/agents' },
  { title: 'Inspiration', href: '/inspiration' },
  { title: 'Model Hub', href: '/pricing' },
  { title: 'Rankings', href: '/rankings' },
]
