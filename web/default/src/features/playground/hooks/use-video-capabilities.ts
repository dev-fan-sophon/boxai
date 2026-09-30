import { useQuery } from '@tanstack/react-query'

import { getVideoCapabilities } from '../api'
import type {
  VideoModelCapabilities,
  VideoReferenceMode,
} from '../lib/studio/video-capabilities'

export type VideoCapabilityMode = 'text' | 'frames' | 'references'
export type VideoCapabilities = Partial<
  Record<VideoCapabilityMode, VideoModelCapabilities>
>

export const videoCapabilitiesQueryKey = (group: string, model: string) => [
  'playground',
  'video-capabilities',
  group,
  model,
]

export function getVideoCapabilityMode(
  hasImages: boolean,
  referenceMode: VideoReferenceMode | undefined
): VideoCapabilityMode {
  if (!hasImages) return 'text'
  return referenceMode === 'references' ? 'references' : 'frames'
}

export function useVideoCapabilities(
  group: string,
  model: string,
  enabled = true
) {
  return useQuery({
    queryKey: videoCapabilitiesQueryKey(group, model),
    queryFn: () => getVideoCapabilities(group, model),
    enabled: enabled && Boolean(group && model),
  })
}
