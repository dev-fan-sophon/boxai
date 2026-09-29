import { useQuery } from '@tanstack/react-query'
import i18next from 'i18next'

import { get2FAStatus } from '@/lib/api'

import { PROFILE_QUERY_KEYS } from '../constants'
import type { TwoFAStatus } from '../types'

// ============================================================================
// Two-FA Hook
// ============================================================================

const DEFAULT_STATUS: TwoFAStatus = {
  enabled: false,
  locked: false,
  backup_codes_remaining: 0,
}

export function useTwoFA(enabled = true) {
  const query = useQuery({
    queryKey: PROFILE_QUERY_KEYS.twoFAStatus,
    queryFn: async (): Promise<TwoFAStatus> => {
      const response = await get2FAStatus()
      if (!response.success || !response.data) {
        throw new Error(
          response.message || i18next.t('Failed to load 2FA status')
        )
      }
      return response.data
    },
    enabled,
    retry: false,
  })

  return {
    status: query.data ?? DEFAULT_STATUS,
    loading: query.isPending,
    isError: query.isError,
    refetch: query.refetch,
  }
}
