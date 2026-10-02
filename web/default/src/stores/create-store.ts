import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import {
  MAX_STORYBOARD_SCENES,
  type CreateTool,
} from '@/features/create/constants'

/** Single prompt, one prompt per line, or a scene-by-scene storyboard. */
export type CreateMode = 'single' | 'batch' | 'storyboard'

export type CreateMainTab = 'results' | 'projects' | 'api'

/**
 * A first frame attached to a scene. `dataUrl` lives for the current tab
 * only; after a reload the uploaded asset id is refetched before submit.
 */
export type StoryboardFrame = {
  id: string
  name: string
  assetId?: number
  dataUrl?: string
}

export type StoryboardScene = {
  id: string
  prompt: string
  frame?: StoryboardFrame
  selected: boolean
  /** Batch of the latest generation; links the scene to its feed results. */
  batchId?: string
}

export type StoryboardDraft = {
  script: string
  style: string
  shotCount: number
  scenes: StoryboardScene[]
  /**
   * Generate scenes one after another, each starting from the previous
   * scene's last frame (unless the scene has its own first frame).
   */
  chainScenes?: boolean
}

const EMPTY_STORYBOARD: StoryboardDraft = {
  script: '',
  style: '',
  shotCount: 4,
  scenes: [],
}

type CreateStoreState = {
  lastTool: CreateTool
  /** Storyboard is a video-only mode; image/video batch mode stays in studio settings. */
  storyboardMode: boolean
  mainTab: CreateMainTab
  /** Chat model that splits a script into scenes. */
  storyboardModel: string
  /** Storyboards by studio session id. */
  storyboards: Record<string, StoryboardDraft>

  setLastTool: (tool: CreateTool) => void
  setStoryboardMode: (enabled: boolean) => void
  setMainTab: (tab: CreateMainTab) => void
  setStoryboardModel: (model: string) => void
  patchStoryboard: (
    sessionId: string,
    patch: Partial<Omit<StoryboardDraft, 'scenes'>>
  ) => void
  setScenes: (
    sessionId: string,
    updater: (scenes: StoryboardScene[]) => StoryboardScene[]
  ) => void
  resetCreateData: () => void
}

export function newStoryboardScene(prompt = ''): StoryboardScene {
  return { id: nanoid(10), prompt, selected: true }
}

export function selectStoryboard(
  state: Pick<CreateStoreState, 'storyboards'>,
  sessionId: string | null | undefined
): StoryboardDraft {
  if (!sessionId) return EMPTY_STORYBOARD
  return state.storyboards[sessionId] ?? EMPTY_STORYBOARD
}

/** Keep storyboards small in storage: frame bytes are re-read from assets. */
function persistableStoryboards(
  storyboards: Record<string, StoryboardDraft>
): Record<string, StoryboardDraft> {
  const next: Record<string, StoryboardDraft> = {}
  for (const [sessionId, draft] of Object.entries(storyboards)) {
    next[sessionId] = {
      ...draft,
      scenes: draft.scenes.map((scene) => {
        if (!scene.frame) return scene
        if (!scene.frame.assetId) return { ...scene, frame: undefined }
        return { ...scene, frame: { ...scene.frame, dataUrl: undefined } }
      }),
    }
  }
  return next
}

export const useCreateStore = create<CreateStoreState>()(
  persist(
    (set) => ({
      lastTool: 'image',
      storyboardMode: false,
      mainTab: 'results',
      storyboardModel: '',
      storyboards: {},

      setLastTool: (lastTool) => set({ lastTool }),
      setStoryboardMode: (storyboardMode) => set({ storyboardMode }),
      setMainTab: (mainTab) => set({ mainTab }),
      setStoryboardModel: (storyboardModel) => set({ storyboardModel }),
      patchStoryboard: (sessionId, patch) =>
        set((state) => ({
          storyboards: {
            ...state.storyboards,
            [sessionId]: { ...selectStoryboard(state, sessionId), ...patch },
          },
        })),
      setScenes: (sessionId, updater) =>
        set((state) => {
          const current = selectStoryboard(state, sessionId)
          return {
            storyboards: {
              ...state.storyboards,
              [sessionId]: {
                ...current,
                scenes: updater(current.scenes).slice(0, MAX_STORYBOARD_SCENES),
              },
            },
          }
        }),
      resetCreateData: () => set({ storyboards: {} }),
    }),
    {
      name: 'create_store_v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        lastTool: state.lastTool,
        storyboardMode: state.storyboardMode,
        mainTab: state.mainTab,
        storyboardModel: state.storyboardModel,
        storyboards: persistableStoryboards(state.storyboards),
      }),
    }
  )
)
