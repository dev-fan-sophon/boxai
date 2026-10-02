import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CANVAS_PROJECTS_QUERY_KEY } from '@/features/inspiration/constants'
import { createCanvasProject } from '@/features/workbench/api'
import {
  canvasDocumentFromImages,
  type CanvasImageSource,
} from '@/features/workbench/engine/canvas-image-document'

import type { StudioRunSummary } from '@/features/playground/lib/session/session-types'
import { persistedStudioResultUrl } from '@/features/playground/lib/studio/studio-selection'

/** Give up measuring a slow image and let the canvas use its default size. */
const MEASURE_TIMEOUT_MS = 4000
const PROJECT_TITLE_MAX = 60

function readNaturalSize(
  url: string
): Promise<{ naturalWidth: number; naturalHeight: number } | null> {
  return new Promise((resolve) => {
    const image = new Image()
    const timer = window.setTimeout(() => resolve(null), MEASURE_TIMEOUT_MS)
    image.addEventListener('load', () => {
      window.clearTimeout(timer)
      resolve(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? {
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
            }
          : null
      )
    })
    image.addEventListener('error', () => {
      window.clearTimeout(timer)
      resolve(null)
    })
    image.referrerPolicy = 'no-referrer'
    image.src = url
  })
}

/**
 * Opens studio results on the canvas: creates a new canvas project whose
 * document holds one image node per result (in a batch grid), then navigates
 * to it. Only results with a persisted URL can travel; in-tab `data:`/`blob:`
 * results are skipped and counted in a toast.
 */
export function useSendToCanvas() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (runs: StudioRunSummary[]) => {
      const sendable = runs.flatMap((run) => {
        const url = persistedStudioResultUrl(run)
        return url ? [{ run, url }] : []
      })
      const skipped = runs.length - sendable.length
      if (sendable.length === 0) return { project: null, sent: 0, skipped }

      const sources: CanvasImageSource[] = await Promise.all(
        sendable.map(async (entry) => ({
          url: entry.url,
          assetId: entry.run.assetId,
          prompt: entry.run.prompt,
          model: entry.run.model,
          ...(await readNaturalSize(entry.url)),
        }))
      )
      const doc = canvasDocumentFromImages(sources, {
        viewportSize: { width: window.innerWidth, height: window.innerHeight },
        fallbackTitle: t('Generated image'),
      })
      let title = sendable[0].run.prompt?.trim() || t('Studio selection')
      if (title.length > PROJECT_TITLE_MAX) {
        title = `${title.slice(0, PROJECT_TITLE_MAX - 1).trimEnd()}…`
      }
      const project = await createCanvasProject({
        title,
        doc: JSON.stringify(doc),
        cover: sources[0].url,
      })
      return { project, sent: sendable.length, skipped }
    },
    onSuccess: (result) => {
      if (!result.project) {
        toast.error(
          t(
            'These images are not saved to your library yet, so they cannot be sent to the canvas.'
          )
        )
        return
      }
      if (result.skipped > 0) {
        toast.warning(
          t('{{count}} unsaved images were skipped.', {
            count: result.skipped,
          })
        )
      }
      toast.success(
        t('Sent {{count}} images to a new canvas', { count: result.sent })
      )
      void queryClient.invalidateQueries({
        queryKey: CANVAS_PROJECTS_QUERY_KEY,
      })
      void navigate({
        to: '/inspiration/$projectId',
        params: { projectId: String(result.project.id) },
      })
    },
    onError: () => toast.error(t('Failed to create the canvas')),
  })

  return {
    sendToCanvas: mutation.mutate,
    sending: mutation.isPending,
  }
}
