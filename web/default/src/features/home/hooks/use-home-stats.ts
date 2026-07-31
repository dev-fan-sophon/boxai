import { useQuery } from '@tanstack/react-query'

import { getHomeStats } from '../api'

export function useHomeStats() {
  return useQuery({
    queryKey: ['home', 'stats'],
    queryFn: getHomeStats,
    staleTime: 5 * 60 * 1000,
  })
}
