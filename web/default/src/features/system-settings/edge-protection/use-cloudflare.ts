import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { getCloudflareStatus } from './api'

export const CLOUDFLARE_STATUS_QUERY_KEY = ['cloudflare', 'status'] as const

export function useCloudflareStatus() {
  return useQuery({
    queryKey: CLOUDFLARE_STATUS_QUERY_KEY,
    queryFn: getCloudflareStatus,
    retry: false,
    staleTime: 30_000,
  })
}

type EdgeMutationResponse = {
  success: boolean
  message?: string
}

/**
 * Every edge control writes straight through to Cloudflare, so a failure has to
 * report Cloudflare's own wording (plan limits, token scope, disabled features)
 * instead of a generic error, and a success has to invalidate the status query
 * because the panel mirrors live zone state rather than local form state.
 */
export function useCloudflareMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<EdgeMutationResponse>,
  successMessage: string
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      if (!data.success) {
        toast.error(data.message)
        return
      }
      toast.success(successMessage)
      void queryClient.invalidateQueries({
        queryKey: CLOUDFLARE_STATUS_QUERY_KEY,
      })
    },
  })
}
