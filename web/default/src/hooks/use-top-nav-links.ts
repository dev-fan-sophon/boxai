import { useMemo } from 'react'

import { useStatus } from '@/hooks/use-status'
import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

export type TopNavLink = {
  title: string
  href: string
  disabled?: boolean
  requiresAuth?: boolean
  external?: boolean
}

/**
 * Generate top navigation links based on HeaderNavModules configuration from backend /api/status
 * Backend format example (stringified JSON):
 * {
 *   home: true,
 *   console: true,
 *   pricing: { enabled: true, requireAuth: false },
 *   rankings: { enabled: true, requireAuth: false },
 *   docs: true,
 *   about: false
 * }
 *
 * Default strip: Home · Workspace · Agents · Inspiration · Model Hub · Docs · Rankings.
 * About stays in the footer only (not the header strip).
 * Console/Dashboard is a CTA in PublicHeader, not a strip text link.
 * Titles stay English i18n source keys; consumers translate them.
 */
export function useTopNavLinks(): TopNavLink[] {
  const { status } = useStatus()
  const user = useAuthStore((state) => state.auth.user)

  // Parse HeaderNavModules
  const modules = useMemo(() => {
    return parseHeaderNavModulesFromStatus(
      status as Record<string, unknown> | null
    )
  }, [status])

  const isAuthed = !!user

  const links: TopNavLink[] = []

  // Public navigation order:
  // Home · Workspace · Agents · Inspiration · Model Hub · Docs · Rankings.
  // About is footer-only. Dashboard is a primary CTA in PublicHeader.

  if (modules?.home !== false) {
    links.push({ title: 'Home', href: '/' })
  }

  if (modules.playground.enabled) {
    links.push({ title: 'Workspace', href: '/playground' })
  }

  if (modules.agents.enabled) {
    links.push({ title: 'Agents', href: '/agents' })
  }

  if (modules.inspiration.enabled) {
    links.push({ title: 'Inspiration', href: '/inspiration' })
  }

  const pricing = modules?.pricing
  if (pricing && typeof pricing === 'object' && pricing.enabled) {
    const requiresAuth = pricing.requireAuth && !isAuthed
    links.push({ title: 'Model Hub', href: '/pricing', requiresAuth })
  }

  if (modules?.docs !== false) {
    links.push({ title: 'Docs', href: '/docs/start/getting-started' })
  }

  const rankings = modules?.rankings
  if (rankings && typeof rankings === 'object' && rankings.enabled) {
    const requiresAuth = rankings.requireAuth && !isAuthed
    links.push({ title: 'Rankings', href: '/rankings', requiresAuth })
  }

  return links
}
