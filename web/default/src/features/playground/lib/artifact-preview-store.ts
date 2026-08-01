import { create } from 'zustand'

import type { ManagedDocumentArtifact } from '../types'

/**
 * Which generated artifact is open in the side preview panel. A tiny global
 * store because the open button lives deep in the message tree while the
 * panel is a sibling of the chat column.
 */
type ArtifactPreviewState = {
  artifact: ManagedDocumentArtifact | null
  open: (artifact: ManagedDocumentArtifact) => void
  close: () => void
}

export const useArtifactPreviewStore = create<ArtifactPreviewState>((set) => ({
  artifact: null,
  open: (artifact) => set({ artifact }),
  close: () => set({ artifact: null }),
}))
