import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18next from 'i18next'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { initReactI18next } from 'react-i18next'

import { TooltipProvider } from '@/components/ui/tooltip'

import {
  MediaReferenceSlot,
  type MediaReference,
} from './components/composer/attachments/media-reference-slot'
import { StudioFeed } from './components/workspace/studio-feed'
import type { StudioRunSummary } from './lib/session/session-types'

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

export type LifecycleFixture = {
  modality?: 'image' | 'audio' | 'video'
  runs?: StudioRunSummary[]
  references?: Omit<MediaReference, 'file'>[]
  maxFiles?: number
  kind?: 'image' | 'video' | 'audio'
  attachable?: boolean
  unmount?: boolean
}

declare global {
  interface Window {
    renderLifecycleFixture: (state: LifecycleFixture) => void
    referenceChanges: MediaReference[][]
  }
}

window.referenceChanges = []
window.renderLifecycleFixture = (state) => {
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
          {!state.modality && !state.unmount ? (
            <MediaReferenceSlot
              label='References'
              value={state.references ?? []}
              maxFiles={state.maxFiles}
              kind={state.kind}
              attachable={state.attachable}
              onChange={(value) => window.referenceChanges.push(value)}
            />
          ) : null}
        </TooltipProvider>
      </QueryClientProvider>
    )
  )
}
