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
