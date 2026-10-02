import {
  BATCH_COUNTS,
  clampBatchCount,
} from '@/features/playground/lib/studio/batch-plan'
import { normalizeImageCount } from '@/features/playground/lib/studio/image-request-schema'
import { usePlaygroundStore } from '@/stores/playground-store'

import type { CreateTool } from '../constants'
import type { GenerationDraft } from './use-generation-draft'

/**
 * How many results each prompt produces — "one prompt, several videos".
 * Images and videos keep their own persisted count; every take is queued as
 * its own job, so the count multiplies the run like an extra prompt would.
 */
export function useOutputCount(modality: CreateTool, draft: GenerationDraft) {
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )
  const settings = draft.settings
  const value =
    modality === 'image'
      ? normalizeImageCount(settings.imageCount)
      : (draft.videoOptions?.count ?? clampBatchCount(settings.videoCount))

  const setValue = (next: number) => {
    if (modality === 'image') {
      const imageCount = normalizeImageCount(next)
      setStudioSettings((prev) => ({ ...prev, imageCount }))
      return
    }
    const videoCount = clampBatchCount(next)
    setStudioSettings((prev) => ({ ...prev, videoCount }))
  }

  return {
    value,
    setValue,
    options: BATCH_COUNTS,
    supported: modality === 'image' || modality === 'video',
  }
}
