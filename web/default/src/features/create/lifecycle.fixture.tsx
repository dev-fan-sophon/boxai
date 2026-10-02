/* eslint-disable react-refresh/only-export-components -- test fixture entry */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18next from 'i18next'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { initReactI18next } from 'react-i18next'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { StudioRunSummary } from '@/features/playground/lib/session/session-types'
import { useAuthStore } from '@/stores/auth-store'
import { usePlaygroundStore } from '@/stores/playground-store'

import { GenerationComposer } from './components/composer/generation-composer'
import { StudioFeed } from './components/feed/studio-feed'
import {
  MediaReferenceSlot,
  type MediaReference,
} from './components/references/media-reference-slot'
import { useGenerationController } from './hooks/use-generation-controller'
import { useGenerationDraft } from './hooks/use-generation-draft'
import { useStudio } from './hooks/use-studio'

// Real components and HTTP calls; only the test's network routes supply data.
await i18next
  .use(initReactI18next)
  .init({ lng: 'en', resources: {}, fallbackLng: 'en' })
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})
const rootElement = document.querySelector('#root')
if (!rootElement) throw new Error('Missing lifecycle fixture root')
const root = createRoot(rootElement)

/** The real composer, wired to a real controller with fixture references. */
function VideoComposerFixture(props: { references: MediaReference[] }) {
  const studio = useStudio()
  const controller = useGenerationController({
    modality: 'video',
    studio,
    canSubmit: () => true,
  })
  const draft = useGenerationDraft({
    modality: 'video',
    text: controller.text,
    references: props.references,
    uploading: false,
  })
  return (
    <GenerationComposer
      controller={{
        ...controller,
        draft,
        references: props.references,
        setReferences: (value) => {
          if (Array.isArray(value)) window.referenceChanges.push(value)
        },
      }}
    />
  )
}

export type LifecycleFixture = {
  modality?: 'image' | 'audio' | 'video'
  runs?: StudioRunSummary[]
  references?: Omit<MediaReference, 'file'>[]
  maxFiles?: number
  kind?: 'image' | 'video' | 'audio'
  attachable?: boolean
  unmount?: boolean
  videoComposer?: boolean
  group?: string
}

declare global {
  interface Window {
    renderLifecycleFixture: (state: LifecycleFixture) => void
    referenceChanges: MediaReference[][]
  }
}

window.referenceChanges = []
// Video capabilities are a signed-in endpoint; the fixture plays a user.
useAuthStore.getState().auth.setUser({ id: 1, username: 'fixture', role: 1 })
window.renderLifecycleFixture = (state) => {
  if (state.videoComposer) {
    usePlaygroundStore.setState((current) => ({
      config: {
        ...current.config,
        model: 'video-model',
        group: state.group ?? 'g',
      },
    }))
  }
  let attachmentContent: React.ReactNode = null
  if (!state.modality && !state.unmount) {
    attachmentContent = state.videoComposer ? (
      <VideoComposerFixture references={state.references ?? []} />
    ) : (
      <MediaReferenceSlot
        label='References'
        value={state.references ?? []}
        maxFiles={state.maxFiles}
        kind={state.kind}
        attachable={state.attachable}
        onChange={(value) => window.referenceChanges.push(value)}
      />
    )
  }
  flushSync(() =>
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          {state.modality ? (
            <StudioFeed
              modality={state.modality}
              batches={[
                {
                  key: 'batch',
                  prompt: '',
                  prompts: [],
                  runs: state.runs ?? [],
                  pending: [],
                },
              ]}
              onReusePrompt={() => {}}
              onRerun={() => {}}
              onSendToCanvas={() => {}}
              sendingToCanvas={false}
              onRetry={() => {}}
              onCancelQueued={() => {}}
              onDismiss={() => {}}
            />
          ) : null}
          {attachmentContent}
        </TooltipProvider>
      </QueryClientProvider>
    )
  )
}
