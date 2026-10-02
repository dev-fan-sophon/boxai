import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { estimatePlaygroundCost } from '@/features/playground/api'
import { useAuthStore } from '@/stores/auth-store'

export type CostEstimateParams = {
  modality: string
  n?: number
  size?: string
  duration?: number
  has_reference?: boolean
  max_tokens?: number
}

/**
 * Debounced server estimate for the pending run. Every caller with the same
 * inputs shares one query, so the price badge and the balance guard never
 * fire duplicate requests.
 */
export function useCostEstimate(input: {
  modelName?: string
  group: string
  params?: CostEstimateParams
}) {
  const [debounced, setDebounced] = useState(input.params)
  const signedIn = useAuthStore((state) => Boolean(state.auth.user))

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(input.params), 350)
    return () => window.clearTimeout(handle)
  }, [input.params])

  return useQuery({
    // An estimate built on an assumed prompt size is a display guess, not a
    // quote; callers treat it as unknown (no amount, no balance block).
    select: (data) => (data?.message?.startsWith('assumed ') ? null : data),
    queryKey: [
      'playground',
      'estimate',
      input.modelName,
      input.group,
      debounced,
    ],
    queryFn: () =>
      estimatePlaygroundCost({
        modality: debounced?.modality ?? 'chat',
        model: input.modelName ?? '',
        group: input.group,
        n: debounced?.n,
        size: debounced?.size,
        duration: debounced?.duration,
        has_reference: debounced?.has_reference,
        max_tokens: debounced?.max_tokens,
        // Rough display estimate; backend also defaults when omitted
        prompt_tokens: debounced?.modality === 'chat' ? 500 : undefined,
      }),
    enabled: signedIn && Boolean(input.modelName && debounced),
    staleTime: 30_000,
  })
}

/**
 * Compares an estimated quota against the signed-in balance. The server
 * still decides; this only stops a batch that is certain to fail with
 * "insufficient credit" from being queued scene after scene.
 */
export function useBalanceShortfall(estimatedQuota?: number): number | null {
  const balance = useAuthStore((state) => state.auth.user?.quota)
  if (estimatedQuota === undefined || !Number.isFinite(estimatedQuota)) {
    return null
  }
  if (balance === undefined || !Number.isFinite(balance)) return null
  return estimatedQuota > balance ? estimatedQuota - balance : null
}
