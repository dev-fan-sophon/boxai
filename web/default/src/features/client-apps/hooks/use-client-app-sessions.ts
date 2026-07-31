import { useQuery } from '@tanstack/react-query'

import type { ClientAppId } from '@/features/downloads/use-app-release'
import { getDesktopSessions } from '@/features/profile/api'
import type { DesktopSession } from '@/features/profile/types'

import { CONNECT_SESSION_PREFIX } from '../constants'

export const clientAppSessionsQueryKey = ['client-apps', 'sessions'] as const

export function appOfSession(session: DesktopSession): ClientAppId {
  return session.client_name?.startsWith(CONNECT_SESSION_PREFIX)
    ? 'connect'
    : 'desktop'
}

/**
 * Live desktop authorization sessions, split by the app that created them.
 * A signed-in install is what "connected" means for both client apps.
 */
export function useClientAppSessions() {
  const query = useQuery({
    queryKey: clientAppSessionsQueryKey,
    queryFn: async () => {
      const response = await getDesktopSessions()
      if (!response.success) throw new Error(response.message)
      return (response.data ?? []).filter((session) => !session.revoked_at)
    },
    staleTime: 60 * 1000,
  })

  const sessions = query.data ?? []
  return {
    connect: sessions.filter((session) => appOfSession(session) === 'connect'),
    desktop: sessions.filter((session) => appOfSession(session) === 'desktop'),
    loading: query.isPending,
    failed: query.isError,
    fetching: query.isFetching,
    refetch: query.refetch,
  }
}
