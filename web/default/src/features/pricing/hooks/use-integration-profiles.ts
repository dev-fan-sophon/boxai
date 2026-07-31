import { useQuery } from '@tanstack/react-query'

import { getIntegrationProfiles } from '../api'

export function useIntegrationProfiles(enabled = true) {
  return useQuery({
    queryKey: ['integration-profiles'],
    queryFn: getIntegrationProfiles,
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}
