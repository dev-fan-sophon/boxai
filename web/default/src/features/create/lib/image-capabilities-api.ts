import {
  parseImageCapabilities,
  type ImageModelCapabilities,
} from '@/features/playground/lib/studio/image-capabilities'
import { api } from '@/lib/api'

export const imageCapabilitiesQueryKey = (group: string, model: string) => [
  'playground',
  'image-capabilities',
  group,
  model,
]

/**
 * Image options every channel serving `model` in `group` supports. Null when
 * the model is unmodeled or no channel can route it.
 */
export async function getImageCapabilities(
  group: string,
  model: string
): Promise<ImageModelCapabilities | null> {
  const response = await api.get('/api/playground/image-capabilities', {
    params: { group, model },
  })
  if (!response.data?.success) return null
  return parseImageCapabilities(response.data.data)
}
