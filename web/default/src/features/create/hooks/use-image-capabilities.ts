import { useQuery } from '@tanstack/react-query'

import { isPlaygroundImageModel } from '@/features/playground/lib/studio/image-request-schema'
import { useAuthStore } from '@/stores/auth-store'

import {
  getImageCapabilities,
  imageCapabilitiesQueryKey,
} from '../lib/image-capabilities-api'

/**
 * Per-model image contract for the selected group. Guests skip the request:
 * the endpoint needs a session and must not trip the global 401 handler.
 */
export function useImageCapabilities(
  group: string,
  model: string,
  enabled = true
) {
  const signedIn = useAuthStore((state) => Boolean(state.auth.user))
  return useQuery({
    queryKey: imageCapabilitiesQueryKey(group, model),
    queryFn: () => getImageCapabilities(group, model),
    enabled:
      enabled &&
      signedIn &&
      Boolean(group && model) &&
      isPlaygroundImageModel(model),
    staleTime: 5 * 60_000,
  })
}
