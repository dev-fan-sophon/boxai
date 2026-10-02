import {
  resolveImageOptions,
  type ImageModelCapabilities,
  type ResolvedImageOptions,
} from '@/features/playground/lib/studio/image-capabilities'
import { normalizeImageGenerationSettings } from '@/features/playground/lib/studio/image-request-schema'
import type { StudioSettings } from '@/features/playground/types'
import { usePlaygroundStore } from '@/stores/playground-store'

import { useImageCapabilities } from './use-image-capabilities'

/**
 * Image settings as the selected model sees them: the capability contract,
 * the stored settings clamped onto it, and a typed setter. The desktop
 * settings panel and the mobile composer chips both render from this, so
 * they always show the same effective values.
 */
export function useImageOptions() {
  const settings = usePlaygroundStore((state) => state.studioSettings)
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )
  const model = usePlaygroundStore((state) => state.config.model)
  const group = usePlaygroundStore((state) => state.config.group)
  const query = useImageCapabilities(group, model)
  const capabilities: ImageModelCapabilities | null = query.data ?? null
  const normalized = normalizeImageGenerationSettings(settings)
  const options: ResolvedImageOptions | null = capabilities
    ? resolveImageOptions(capabilities, settings)
    : null

  const update = <K extends keyof StudioSettings>(
    key: K,
    value: StudioSettings[K]
  ) => setStudioSettings((prev) => ({ ...prev, [key]: value }))

  return { model, settings, normalized, capabilities, options, query, update }
}
