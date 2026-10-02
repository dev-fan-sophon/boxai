import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Code2,
  FolderClock,
  Plus,
  Settings2,
  Sparkles,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SessionHistoryPanel } from '@/features/playground/components/shell/session-history-panel'
import {
  getAudioKind,
  getModelModality,
  type AudioKind,
} from '@/features/playground/lib/studio/model-modality'
import { useLgUp } from '@/hooks'
import { useCreateStore, type CreateMainTab } from '@/stores/create-store'
import { usePlaygroundStore } from '@/stores/playground-store'

import type { CreateTool } from '../../constants'
import { useStudioContext } from '../../context/studio-context'
import { useCreateWorkspace } from '../../context/workspace-context'
import { useGenerationController } from '../../hooks/use-generation-controller'
import { useSendToCanvas } from '../../hooks/use-send-to-canvas'
import { useStoryboard } from '../../hooks/use-storyboard'
import { ApiSnippetPanel } from '../api/api-snippet-panel'
import { GenerationComposer } from '../composer/generation-composer'
import { ModelHero } from '../feed/model-hero'
import { StudioFeed } from '../feed/studio-feed'
import { ControlPanel } from '../panel/control-panel'
import { ModelPicker } from '../panel/model-picker'
import { StoryboardBoard } from '../storyboard/storyboard-board'
import { StoryboardScriptPanel } from '../storyboard/storyboard-script-panel'
import { AudioToolSwitch } from './audio-tool-switch'

/** Starter prompts per audio tool; file-based tools start from an upload. */
const AUDIO_EXAMPLE_KEYS: Record<AudioKind, string[]> = {
  speech: [
    'Welcome to BoxAI. This voice was generated in seconds.',
    'Hello! Welcome to BoxAI. How can I help you today?',
  ],
  sfx: [
    'Heavy rain on a tin roof at night, distant thunder',
    'Motorbikes passing on a busy Saigon street',
  ],
  music: [
    'Upbeat lo-fi beat with soft piano, 90 BPM, for studying',
    'Cinematic orchestral intro with rising strings and drums',
  ],
  transcribe: [],
  'voice-changer': [],
  isolate: [],
  align: [],
}

type CreateMode = 'single' | 'batch' | 'storyboard'

/**
 * One creation tool. Desktop: control column on the left (model, mode,
 * prompt, references, parameters, Generate) and the work area on the right
 * with Results · Projects · API tabs. Mobile: the work area with a docked
 * composer; the full control column opens as a sheet.
 */
export function CreateWorkspace(props: { tool: CreateTool }) {
  const { t } = useTranslation()
  const tool = props.tool
  const studio = useStudioContext()
  const workspace = useCreateWorkspace()
  const isDesktop = useLgUp()
  const [controlsOpen, setControlsOpen] = useState(false)
  const controller = useGenerationController({
    modality: tool,
    studio,
    canSubmit: workspace.requireAuthentication,
  })
  const storyboard = useStoryboard({ controller, studio })
  const canvas = useSendToCanvas()

  const model = usePlaygroundStore((state) => state.config.model)
  const selectModel = usePlaygroundStore((state) => state.selectModel)
  const setStudioSettings = usePlaygroundStore(
    (state) => state.setStudioSettings
  )
  const startNewSession = usePlaygroundStore((state) => state.startNewSession)
  const models = usePlaygroundStore((state) => state.models)
  const storyboardEnabled = useCreateStore((state) => state.storyboardMode)
  const setStoryboardMode = useCreateStore((state) => state.setStoryboardMode)
  const mainTab = useCreateStore((state) => state.mainTab)
  const setMainTab = useCreateStore((state) => state.setMainTab)
  const pricingModel = workspace.findCatalogModel(model)
  const storyboardMode = tool === 'video' && storyboardEnabled

  const chatModels = useMemo(
    () =>
      models
        .map((option) => option.value)
        .filter((name) => {
          const catalog = workspace.findCatalogModel(name)
          return getModelModality(catalog ?? { model_name: name }) === 'chat'
        }),
    [models, workspace]
  )

  // Audio: the first callable model of every audio sub-tool, so switching
  // tools can move to a model that serves it.
  const audioModelByKind = useMemo(() => {
    const byKind = new Map<AudioKind, string>()
    if (tool !== 'audio') return byKind
    const callable = new Set(models.map((option) => option.value))
    const sorted = [...workspace.catalogModels].sort((a, b) =>
      a.model_name.localeCompare(b.model_name)
    )
    for (const catalog of sorted) {
      if (!callable.has(catalog.model_name)) continue
      const kind = getAudioKind(catalog)
      if (kind && !byKind.has(kind)) byKind.set(kind, catalog.model_name)
    }
    return byKind
  }, [tool, models, workspace.catalogModels])
  const audioAvailableKinds = useMemo(
    () => new Set(audioModelByKind.keys()),
    [audioModelByKind]
  )
  const audioState = controller.draft.audio

  // A model picked elsewhere (Model Hub link, another tab) decides the tool.
  useEffect(() => {
    if (tool !== 'audio' || !audioState.modelKind) return
    if (audioState.modelKind === audioState.tool) return
    const modelKind = audioState.modelKind
    setStudioSettings((prev) => ({ ...prev, audioTool: modelKind }))
  }, [tool, audioState.modelKind, audioState.tool, setStudioSettings])

  const changeAudioTool = (next: AudioKind) => {
    setStudioSettings((prev) => ({ ...prev, audioTool: next }))
    const nextModel = audioModelByKind.get(next)
    if (audioState.modelKind !== next && nextModel) {
      selectModel(nextModel, undefined, { switchModality: 'audio' })
    }
  }

  let mode: CreateMode = 'single'
  if (storyboardMode) mode = 'storyboard'
  else if (controller.draft.batchMode) mode = 'batch'

  const changeMode = (next: CreateMode) => {
    setStoryboardMode(next === 'storyboard')
    if (next === 'storyboard') return
    const batch = next === 'batch'
    setStudioSettings((prev) =>
      tool === 'image'
        ? { ...prev, imageBatchMode: batch }
        : { ...prev, videoBatchMode: batch }
    )
  }

  const modeOptions: Array<{ value: CreateMode; label: string }> = [
    { value: 'single', label: t('Single') },
    { value: 'batch', label: t('Batch') },
  ]
  if (tool === 'video') {
    modeOptions.push({ value: 'storyboard', label: t('Storyboard') })
  }

  const runnableScenes = storyboard.selected.filter((scene) =>
    scene.prompt.trim()
  )

  const modelPicker = (
    <ModelPicker
      modality={tool}
      audioKind={tool === 'audio' ? audioState.tool : undefined}
      catalogModels={workspace.catalogModels}
      loading={workspace.pricing.isLoading || workspace.isLoadingModels}
      value={model}
      onChange={(name) =>
        selectModel(name, undefined, { switchModality: tool })
      }
    />
  )
  const modeSwitch =
    tool === 'audio' ? (
      <AudioToolSwitch
        value={audioState.tool}
        availableKinds={audioAvailableKinds}
        onValueChange={changeAudioTool}
      />
    ) : (
      <SegmentedControl<CreateMode>
        fullWidth
        aria-label={t('Creation mode')}
        value={mode}
        options={modeOptions}
        onValueChange={changeMode}
      />
    )

  const controlPanel = (
    <ControlPanel
      controller={controller}
      pricingModel={pricingModel}
      modelPicker={modelPicker}
      modeSwitch={modeSwitch}
      storyboard={
        storyboardMode
          ? {
              panel: (
                <StoryboardScriptPanel
                  storyboard={storyboard}
                  chatModels={chatModels}
                />
              ),
              sceneCount: runnableScenes.length,
              onGenerate: () => void storyboard.generate(runnableScenes),
            }
          : undefined
      }
    />
  )

  const supportsReferences = tool === 'image' || tool === 'video'
  let results: React.ReactNode
  if (storyboardMode) {
    results = <StoryboardBoard storyboard={storyboard} studio={studio} />
  } else if (controller.batches.length === 0) {
    results = (
      <ModelHero
        model={pricingModel}
        modelName={model}
        modality={tool}
        onPickExample={controller.setText}
        exampleKeys={
          tool === 'audio'
            ? AUDIO_EXAMPLE_KEYS[controller.draft.settings.audioTool]
            : undefined
        }
      />
    )
  } else {
    results = (
      <div className='mx-auto w-full max-w-6xl px-3 pt-3 pb-6 sm:px-4 md:px-6'>
        <StudioFeed
          modality={tool}
          batches={controller.batches}
          onReusePrompt={controller.reusePrompt}
          onRerun={(prompts) => controller.startJobs(prompts)}
          onUseAsReference={
            supportsReferences
              ? (image) => void controller.addReferencesFromResults([image])
              : undefined
          }
          onUseAsReferences={
            supportsReferences
              ? (images) => void controller.addReferencesFromResults(images)
              : undefined
          }
          onVary={
            tool === 'image'
              ? (image) => void controller.varyResult(image)
              : undefined
          }
          onContinueFromFrame={
            tool === 'video' ? controller.continueFromFrame : undefined
          }
          sendingToCanvas={canvas.sending}
          onSendToCanvas={(runs) => {
            if (workspace.requireAuthentication()) canvas.sendToCanvas(runs)
          }}
          onRetry={studio.retryRuns}
          onCancelQueued={studio.cancelQueued}
          onDismiss={studio.dismissRuns}
        />
      </div>
    )
  }

  let tabContent = results
  if (mainTab === 'projects') {
    tabContent = (
      <div className='mx-auto h-full w-full max-w-3xl'>
        <SessionHistoryPanel onSelectSession={() => setMainTab('results')} />
      </div>
    )
  } else if (mainTab === 'api') {
    tabContent = (
      <ApiSnippetPanel
        modality={tool}
        model={model}
        prompt={controller.text}
        settings={controller.draft.settings}
        draft={controller.draft}
      />
    )
  }

  return (
    <div className='flex min-h-0 flex-1'>
      {isDesktop && (
        <aside
          className='border-border/70 bg-sidebar/40 flex w-[22rem] shrink-0 flex-col border-r xl:w-[24rem]'
          aria-label={t('Generation controls')}
        >
          {controlPanel}
        </aside>
      )}

      <main className='flex min-h-0 min-w-0 flex-1 flex-col'>
        <div className='border-border/60 flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:px-4'>
          <Tabs
            value={mainTab}
            onValueChange={(value) => setMainTab(value as CreateMainTab)}
          >
            <TabsList>
              <TabsTrigger value='results' className='gap-1.5 px-2.5'>
                <Sparkles aria-hidden='true' />
                {storyboardMode ? t('Storyboard') : t('Results')}
              </TabsTrigger>
              <TabsTrigger value='projects' className='gap-1.5 px-2.5'>
                <FolderClock aria-hidden='true' />
                <span className='sr-only sm:not-sr-only'>{t('Projects')}</span>
              </TabsTrigger>
              <TabsTrigger value='api' className='gap-1.5 px-2.5'>
                <Code2 aria-hidden='true' />
                <span className='sr-only sm:not-sr-only'>API</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <span className='text-muted-foreground hidden min-w-0 flex-1 truncate text-sm md:block'>
            {controller.studioSession?.title}
          </span>
          <span className='flex-1 md:hidden' />
          <Button
            variant='ghost'
            size='sm'
            className='text-muted-foreground hover:text-foreground gap-1.5'
            onClick={() => {
              startNewSession(tool)
              setMainTab('results')
            }}
          >
            <Plus className='size-4' aria-hidden='true' />
            <span className='hidden sm:inline'>{t('New project')}</span>
          </Button>
          {!isDesktop && (
            <Button
              variant='outline'
              size='sm'
              className='gap-1.5'
              onClick={() => setControlsOpen(true)}
            >
              <Settings2 className='size-4' aria-hidden='true' />
              <span className='sr-only sm:not-sr-only'>{t('Controls')}</span>
            </Button>
          )}
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
          {tabContent}
        </div>

        {!isDesktop && !storyboardMode && mainTab === 'results' && (
          <div className='border-border/60 bg-background/85 supports-backdrop-filter:bg-background/72 shrink-0 border-t backdrop-blur-xl'>
            <GenerationComposer
              controller={controller}
              pricingModel={pricingModel}
            />
          </div>
        )}
      </main>

      {!isDesktop && (
        <Sheet open={controlsOpen} onOpenChange={setControlsOpen}>
          <SheetContent
            side='bottom'
            className='h-[min(92dvh,48rem)] gap-0 rounded-t-2xl p-0'
          >
            <SheetHeader className='border-border/60 border-b px-4 py-3'>
              <SheetTitle>{t('Generation controls')}</SheetTitle>
            </SheetHeader>
            <div className='min-h-0 flex-1'>
              <ControlPanel
                {...controlPanel.props}
                onGenerated={() => setControlsOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
