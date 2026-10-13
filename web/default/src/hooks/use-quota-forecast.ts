import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'

import { getQuotaForecast } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Signed-in user's balance runway at their recent spending pace. Shared by
 * the low-balance warning and the Studio balance chip through one query.
 */
export function useQuotaForecast() {
  const userId = useAuthStore((state) => state.auth.user?.id)
  return useQuery({
    queryKey: ['quota-forecast', userId],
    queryFn: getQuotaForecast,
    enabled: userId !== undefined,
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 5,
  })
}

/** Human runway label for a forecast's `days_left`; null when unknown. */
export function formatRunway(daysLeft: number, t: TFunction): string | null {
  if (!Number.isFinite(daysLeft) || daysLeft < 0) return null
  if (daysLeft < 1) return t('less than a day')
  if (daysLeft > 365) return t('more than a year')
  const days = Math.floor(daysLeft)
  return t('about {{count}} days', { count: days })
}
