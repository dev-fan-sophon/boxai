import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { canTryInPlayground } from '@/features/pricing/lib/playground-eligibility'
import { useLgUp, useXlUp } from '@/hooks'
import { useAuthStore } from '@/stores/auth-store'
import {
  selectActiveChatMessages,
  selectActiveSession,
  usePlaygroundStore,
} from '@/stores/playground-store'

import {
  createManagedToolRun,
  createPlaygroundRun,
  generateImages,
  executeManagedSearch,
  importManagedToolRun,
  listUserMemories,
  releasePlaygroundDocumentSandbox,
  submitVideo,
} from './api'
import { ModelCatalog } from './components/catalog/model-catalog'
import { ModelSwitchNotice } from './components/chat/model-switch-notice'
import { PlaygroundChat } from './components/chat/playground-chat'
import { ChatComposer } from './components/composer/chat-composer'
import {
  SettingsPanel,
  SettingsSections,
} from './components/settings/settings-panel'
import { ModalityQuickSwitch } from './components/shell/modality-quick-switch'
import { PlaygroundShell } from './components/shell/playground-shell'
import { WorkspaceHeader } from './components/shell/workspace-header'
import { ArtifactPreviewPanel } from './components/workspace/artifact-preview-panel'
import { DuoWorkspace } from './components/workspace/duo-workspace'
import { GenerationWorkspace } from './components/workspace/generation-workspace'
import {
  patchSessionById,
  useChatHandler,
  usePlaygroundConversation,
  usePlaygroundOptions,
  useSessionCloudSync,
} from './hooks'
import { useAgentChat } from './hooks/use-agent-chat'
import { useAutoChatTitle } from './hooks/use-auto-chat-title'
import { useStudio } from './hooks/use-studio'
import { isAgentChatEnabled } from './lib/agent-chat/flag'
import { useArtifactPreviewStore } from './lib/artifact-preview-store'
import {
  buildDocumentConversationContext,
  runDocumentBuild,
  toDocumentArtifacts,
} from './lib/document-build'
import { persistGeneratedMediaAsset } from './lib/download-generated-media'
import {
  extractManagedSearchResult,
  updateManagedAssistant,
} from './lib/managed-tools'
import { updateAssistantMessageWithError } from './lib/message/message-update-utils'
import { setMessageActiveVersion } from './lib/message/message-utils'
import { isChatSession } from './lib/session/session-utils'
import { isPlaygroundImageModel } from './lib/studio/image-request-schema'
import { getModelModality } from './lib/studio/model-modality'
import type { Message, PlaygroundConfig, StudioModality } from './types'

import './styles/playground.css'

export function Playground() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const search = useSearch({ from: '/_public/playground/' })
  const appliedDeepLink = useRef<string | undefined>(undefined)
  const user = useAuthStore((state) => state.auth.user)
  const isAuthenticated = Boolean(user)
  const [signInDialogOpen, setSignInDialogOpen] = useState(false)
  const [catalogDrawerOpen, setCatalogDrawerOpen] = useState(false)
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false)
  // Settings panel: persisted open state on wide desktop, ephemeral overlay
  // between 1024–1279px, bottom sheet below 1024px.
  const isDesktop = useLgUp()
  const isWideDesktop = useXlUp()
  const [narrowSettingsOpen, setNarrowSettingsOpen] = useState(false)
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false)

  const workspaceMode = usePlaygroundStore((state) => state.workspaceMode)
  const setWorkspaceMode = usePlaygroundStore((state) => state.setWorkspaceMode)
  const activeModality = usePlaygroundStore((state) => state.activeModality)
  const setActiveModality = usePlaygroundStore(
    (state) => state.setActiveModality
  )
  const selectStoreModel = usePlaygroundStore((state) => state.selectModel)
  const selectDuo = usePlaygroundStore((state) => state.selectDuo)
  const startNewSession = usePlaygroundStore((state) => state.startNewSession)
  const setPrefill = usePlaygroundStore((state) => state.setPrefill)
  const settingsPanelOpen = usePlaygroundStore(
    (state) => state.ui.settingsPanelOpen
  )
  const setSettingsPanelOpen = usePlaygroundStore(
    (state) => state.setSettingsPanelOpen
  )
  const chatTools = usePlaygroundStore((state) => state.chatTools)
  const pinnedModels = usePlaygroundStore((state) => state.pinnedModels)
  const togglePinnedModel = usePlaygroundStore(
    (state) => state.togglePinnedModel
  )
  const config = usePlaygroundStore((state) => state.config)
  const parameterEnabled = usePlaygroundStore((state) => state.parameterEnabled)
  const messages = usePlaygroundStore(selectActiveChatMessages)
  const activeSession = usePlaygroundStore(selectActiveSession)
  const models = usePlaygroundStore((state) => state.models)
  const updateMessages = usePlaygroundStore((state) => state.setMessages)
  const setModels = usePlaygroundStore((state) => state.setModels)
  const setGroups = usePlaygroundStore((state) => state.setGroups)
  const patchConfig = usePlaygroundStore((state) => state.updateConfig)
  useSessionCloudSync(isAuthenticated)
  useAutoChatTitle(isAuthenticated)
  const updateConfig = useCallback(
    <K extends keyof PlaygroundConfig>(key: K, value: PlaygroundConfig[K]) => {
      patchConfig({ [key]: value })
    },
    [patchConfig]
  )

  const pricing = usePricingData('playground')
  const playgroundModels = useMemo(() => {
    // Strict mode only when at least one model has an explicit playground
    // integration. Otherwise fall back to the full catalog so production
    // sites that have not configured integrations yet still work.
    if (pricing.isLegacyPlaygroundCatalog) return pricing.models
    const eligible = pricing.models.filter(canTryInPlayground)
    return eligible.length > 0 ? eligible : pricing.models
  }, [pricing.isLegacyPlaygroundCatalog, pricing.models])
  const studio = useStudio()
  const publicModels = useMemo(
    () =>
      playgroundModels.map((model) => ({
        label: model.model_name,
        value: model.model_name,
      })),
    [playgroundModels]
  )
  const publicGroups = useMemo(
    () =>
      Object.entries(pricing.usableGroup).map(([value, group]) => ({
        value,
        label: value,
        desc: typeof group === 'string' ? group : group.desc,
        ratio:
          typeof group === 'string' ? pricing.groupRatio[value] : group.ratio,
      })),
    [pricing.groupRatio, pricing.usableGroup]
  )
  const requireAuthentication = useCallback((): boolean => {
    if (user) return true
    setSignInDialogOpen(true)
    return false
  }, [user])

  const memoriesQuery = useQuery({
    queryKey: ['playground', 'memories'],
    queryFn: listUserMemories,
    enabled: isAuthenticated && chatTools.longMemory,
    staleTime: 60_000,
  })
  const memoryContents = useMemo(
    () => memoriesQuery.data?.items.map((memory) => memory.content) ?? [],
    [memoriesQuery.data]
  )
  const activeChat = isChatSession(activeSession) ? activeSession : undefined
  // Auto mode lets the model decide to search; forced tool modes bypass chat.
  const webSearchToolEnabled = chatTools.mode === 'auto'
  const payloadOptions = useMemo(
    () => ({
      systemPrompt: chatTools.systemPrompt,
      carryHistory: chatTools.carryHistory,
      visualOutput: chatTools.visualOutput,
      modelName: config.model,
      memories: chatTools.longMemory ? memoryContents : undefined,
      summary: activeChat?.memorySummary,
      summaryTailKey: activeChat?.memorySummaryTailKey,
      webSearchTool: webSearchToolEnabled,
    }),
    [
      chatTools.systemPrompt,
      chatTools.carryHistory,
      chatTools.visualOutput,
      chatTools.longMemory,
      config.model,
      memoryContents,
      activeChat?.memorySummary,
      activeChat?.memorySummaryTailKey,
      webSearchToolEnabled,
    ]
  )

  const executeWebSearchTool = useCallback(
    async (query: string) => {
      const response = await createManagedToolRun({
        client_request_id: crypto.randomUUID(),
        model: config.model,
        group: config.group,
        // The model-generated query is the run prompt; direct mode skips the
        // server-side intent classifier.
        user_text: query,
        tool_policy: {
          mode: 'direct',
          enabled: ['web_search'],
          direct: { name: 'web_search', args: {} },
        },
      })
      const run = response.run
      if (run.status === 'unavailable' || run.status === 'failed') {
        throw new Error(run.error || t('Tool is unavailable'))
      }
      const raw = await executeManagedSearch(
        run.id,
        response.execution.execution_token
      )
      const result = extractManagedSearchResult(raw)
      return { runId: run.id, text: result.text }
    },
    [config.group, config.model, t]
  )
  const webSearchToolRunner = useMemo(
    () =>
      webSearchToolEnabled
        ? { maxLoops: chatTools.maxToolLoops, execute: executeWebSearchTool }
        : undefined,
    [chatTools.maxToolLoops, executeWebSearchTool, webSearchToolEnabled]
  )

  const { sendChat, stopGeneration, isGenerating } = useChatHandler({
    config,
    parameterEnabled,
    onMessageUpdate: updateMessages,
    payloadOptions,
    webSearchTool: webSearchToolRunner,
  })
  const activeChatId = activeChat?.id
  const bindAgentConversation = useCallback(
    (conversationId: number) => {
      if (!activeChatId) return
      patchSessionById(activeChatId, {
        serverId: conversationId,
        isDraft: false,
      })
    },
    [activeChatId]
  )
  const { sendAgentTurn, stopAgentTurn, isAgentStreaming } = useAgentChat({
    config,
    onMessageUpdate: updateMessages,
    systemPrompt: chatTools.systemPrompt,
    visualOutput: chatTools.visualOutput,
    longMemory: chatTools.longMemory,
    conversationId: activeChat?.serverId,
    onConversationId: bindAgentConversation,
  })
  // Read once per mount: flipping the flag mid-session would leave an in-flight
  // turn split across two transports.
  const agentChatEnabled = useMemo(() => isAgentChatEnabled(), [])
  const [isRouting, setIsRouting] = useState(false)
  const isRoutingRef = useRef(false)
  // A warm container bills for memory while it waits, so leaving the conversation that owns one
  // should stop paying for it instead of waiting out the sleep timer.
  const documentSandboxRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    const live = documentSandboxRef.current
    if (!live || live === activeSession?.serverId) return
    documentSandboxRef.current = undefined
    void releasePlaygroundDocumentSandbox(live).catch(() => {})
  }, [activeSession?.serverId])
  useEffect(
    () => () => {
      const live = documentSandboxRef.current
      if (live) void releasePlaygroundDocumentSandbox(live).catch(() => {})
    },
    []
  )
  // A preview opened in another conversation must not linger over the new one.
  useEffect(() => {
    useArtifactPreviewStore.getState().close()
  }, [activeSession?.id])

  const canSubmitManagedTurn = useCallback(
    () => !isRoutingRef.current && requireAuthentication(),
    [requireAuthentication]
  )

  const routeManagedTurn = useCallback(
    async (turnMessages: import('./types').Message[], text: string) => {
      if (isRoutingRef.current) return
      isRoutingRef.current = true
      setIsRouting(true)
      const assistantKey = turnMessages.at(-1)?.key
      let directName:
        | 'generate_image'
        | 'generate_video'
        | 'web_search'
        | 'generate_document'
        | undefined
      if (chatTools.mode === 'image') directName = 'generate_image'
      if (chatTools.mode === 'video') directName = 'generate_video'
      if (chatTools.mode === 'search') directName = 'web_search'
      if (chatTools.mode === 'document') directName = 'generate_document'
      const setAssistantTool = (
        managedTool: import('./types').ManagedToolCard,
        sources?: import('./types').MessageSource[],
        content?: string
      ) =>
        updateMessages((previous) =>
          assistantKey
            ? updateManagedAssistant(
                previous,
                assistantKey,
                managedTool,
                sources,
                content
              )
            : previous
        )

      // Runs one document build against an already-created managed run. Shared
      // by the direct document turn and the chained build after a search.
      const executeDocumentBuild = async (
        docRun: { id: number; tool_model?: string },
        executionToken: string,
        setCard: (card: import('./types').ManagedToolCard) => void,
        contextMessages: import('./types').Message[]
      ) => {
        const baseCard = {
          runId: docRun.id,
          action: 'generate_document' as const,
          status: 'running' as const,
          model: docRun.tool_model,
          startedAt: Date.now(),
        }
        setCard({ ...baseCard, stage: 'Preparing the sandbox' })
        // Only attachments that reached the server have an asset id; a text file read in the
        // browser has none and is already in the prompt as text.
        const attachmentIds = (turnMessages.at(-2)?.attachments ?? [])
          .map((attachment) => attachment.assetId)
          .filter((id): id is number => typeof id === 'number' && id > 0)
        if (activeSession?.serverId) {
          documentSandboxRef.current = activeSession.serverId
        }
        const outcome = await runDocumentBuild({
          runId: docRun.id,
          executionToken,
          model: config.model,
          group: config.group,
          userText: text,
          conversationContext:
            buildDocumentConversationContext(contextMessages),
          conversationId: activeSession?.serverId,
          assetIds: attachmentIds,
          onAttempt: (attempt) =>
            setCard({ ...baseCard, documentAttempts: attempt }),
          onStage: (stage, attempt) =>
            setCard({
              ...baseCard,
              documentAttempts: attempt,
              stage:
                stage === 'generate'
                  ? 'Writing the build script'
                  : 'Running the build in the sandbox',
            }),
        })
        const documents = toDocumentArtifacts(
          outcome.result.assets,
          outcome.result.unverified
        )
        setCard({
          ...baseCard,
          status: 'completed',
          documents,
          documentCode: outcome.code,
          documentLogs: outcome.result.logs,
          documentAttempts: outcome.attempts,
        })
      }

      // "Search X, then make a PDF": classification picks exactly one action,
      // so the document half of the request runs as a second managed run once
      // the search text exists, with that text as build material.
      const runChainedDocumentBuild = async (searchText: string) => {
        const docKey = `doc_${crypto.randomUUID()}`
        updateMessages((previous) => [
          ...previous,
          {
            key: docKey,
            from: 'assistant' as const,
            versions: [{ id: `v_${docKey}`, content: '' }],
            status: 'complete' as const,
            createdAt: Date.now(),
          },
        ])
        const setCard = (card: import('./types').ManagedToolCard) =>
          updateMessages((previous) =>
            updateManagedAssistant(previous, docKey, card)
          )
        let chained:
          | Awaited<ReturnType<typeof createManagedToolRun>>
          | undefined
        try {
          chained = await createManagedToolRun({
            client_request_id: crypto.randomUUID(),
            model: config.model,
            group: config.group,
            user_text: text,
            tool_policy: {
              mode: 'direct',
              enabled: ['generate_document'],
              direct: { name: 'generate_document', args: {} },
            },
          })
          if (
            chained.run.status === 'unavailable' ||
            chained.run.status === 'failed'
          ) {
            throw new Error(chained.run.error || t('Tool is unavailable'))
          }
          await executeDocumentBuild(
            chained.run,
            chained.execution.execution_token,
            setCard,
            [
              ...turnMessages.slice(0, -2),
              {
                key: `${docKey}_search`,
                from: 'assistant' as const,
                versions: [{ id: 'v1', content: searchText }],
              },
            ]
          )
        } catch (error) {
          const message =
            error instanceof Error ? error.message : t('Tool failed')
          toast.error(message)
          setCard({
            runId: chained?.run.id,
            action: 'generate_document',
            status: 'failed',
            error: message,
          })
          if (chained && chained.run.status === 'ready') {
            try {
              await importManagedToolRun(chained.run.id, {
                execution_token: chained.execution.execution_token,
                status: 'failed',
                error: message,
              })
            } catch {
              // The card already shows the original failure.
            }
          }
        }
      }

      let response: Awaited<ReturnType<typeof createManagedToolRun>> | undefined
      let action = directName
      try {
        response = await createManagedToolRun({
          client_request_id: crypto.randomUUID(),
          model: config.model,
          group: config.group,
          user_text: text,
          tool_policy: {
            mode: directName ? 'direct' : 'auto',
            enabled: [
              'generate_image',
              'generate_video',
              'web_search',
              'generate_document',
            ],
            direct: directName ? { name: directName, args: {} } : undefined,
          },
        })
        const run = response.run
        action = run.action === 'chat' ? undefined : run.action
        if (run.status === 'unavailable' || run.status === 'failed') {
          throw new Error(run.error || t('Tool is unavailable'))
        }
        if (run.action === 'chat') {
          sendChat(turnMessages)
          return
        }
        const baseCard = {
          runId: run.id,
          action: run.action,
          status: 'running' as const,
          model: run.tool_model,
          startedAt: Date.now(),
        }
        if (run.action === 'web_search') {
          setAssistantTool({
            ...baseCard,
            stage: 'Searching the web',
            stageDetail: text,
          })
          const raw = await executeManagedSearch(
            run.id,
            response.execution.execution_token
          )
          const result = extractManagedSearchResult(raw)
          setAssistantTool(
            { ...baseCard, status: 'completed' },
            result.sources,
            result.text
          )
          if (response.followup_action === 'generate_document') {
            await runChainedDocumentBuild(result.text)
          }
          return
        }
        if (run.action === 'generate_document') {
          // Everything before this turn's user message and assistant
          // placeholder is the material the document is built from.
          await executeDocumentBuild(
            run,
            response.execution.execution_token,
            setAssistantTool,
            turnMessages.slice(0, -2)
          )
          return
        }
        if (run.action === 'generate_image') {
          const toolModel = String(
            response.arguments.model || run.tool_model || ''
          )
          if (!isPlaygroundImageModel(toolModel)) {
            throw new Error(
              t(
                'Playground image generation uses GPT-format models only (gpt-image-2 or grok-imagine-image). Select one and try again.'
              )
            )
          }
          setAssistantTool({ ...baseCard, stage: 'Generating images' })
          const images = await generateImages({
            model: toolModel,
            group: config.group,
            prompt: String(response.arguments.prompt),
            settings: {
              ...studio.settings,
              imageCount:
                Number(response.arguments.n) || studio.settings.imageCount,
              imageSize: String(
                response.arguments.size || studio.settings.imageSize
              ),
              imageQuality: String(
                response.arguments.quality || studio.settings.imageQuality
              ),
            },
            execution: {
              runId: run.id,
              executionToken: response.execution.execution_token,
            },
          })
          setAssistantTool({ ...baseCard, stage: 'Saving results' })
          const assets = await Promise.all(
            images.map((image, index) =>
              persistGeneratedMediaAsset(
                image.url,
                `chat-image-${index + 1}`,
                'image'
              )
            )
          )
          await Promise.all(
            assets.map((asset) =>
              createPlaygroundRun({
                modality: 'image',
                model: run.tool_model || '',
                prompt: text,
                asset_id: asset.id,
              })
            )
          )
          const urls = assets.map((asset) => asset.url)
          await importManagedToolRun(run.id, {
            execution_token: response.execution.execution_token,
            status: 'completed',
            result: { images: urls },
          })
          setAssistantTool({ ...baseCard, status: 'completed', images: urls })
          return
        }
        setAssistantTool({ ...baseCard, stage: 'Submitting the video task' })
        const submission = await submitVideo({
          model: String(response.arguments.model),
          group: config.group,
          prompt: String(response.arguments.prompt),
          settings: {
            ...studio.settings,
            videoDuration:
              Number(response.arguments.duration) ||
              studio.settings.videoDuration,
            videoSize: String(
              response.arguments.size || studio.settings.videoSize
            ),
          },
          execution: {
            runId: run.id,
            executionToken: response.execution.execution_token,
          },
        })
        await createPlaygroundRun({
          modality: 'video',
          model: run.tool_model || '',
          prompt: text,
          task_id: submission.taskId,
        })
        await importManagedToolRun(run.id, {
          execution_token: response.execution.execution_token,
          status: 'submitted',
          task_id: submission.taskId,
        })
        setAssistantTool({
          ...baseCard,
          status: 'submitted',
          taskId: submission.taskId,
          stage: 'Waiting for the video to render',
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t('Tool failed')
        toast.error(message)
        if (response && response.run.status === 'ready') {
          try {
            await importManagedToolRun(response.run.id, {
              execution_token: response.execution.execution_token,
              status: 'failed',
              error: message,
            })
          } catch {
            // Preserve the original execution error for the user.
          }
        }
        if (action) {
          setAssistantTool({
            runId: response?.run.id,
            action,
            status: 'failed',
            error: message,
          })
        } else if (assistantKey) {
          updateMessages((previous) =>
            updateAssistantMessageWithError(previous, message)
          )
        }
      } finally {
        isRoutingRef.current = false
        setIsRouting(false)
      }
    },
    [
      activeSession?.serverId,
      chatTools.mode,
      config.group,
      config.model,
      sendChat,
      studio.settings,
      t,
      updateMessages,
    ]
  )

  const {
    editingMessageKey,
    handleSendMessage,
    handleRegenerateMessage,
    handleEditMessage,
    handleEditOpenChange,
    applyEdit,
    handleDeleteMessage,
  } = usePlaygroundConversation({
    messages,
    updateMessages,
    sendChat,
    routeTurn: routeManagedTurn,
    agentTurn: agentChatEnabled ? sendAgentTurn : undefined,
    canSubmit: canSubmitManagedTurn,
    activeModel: config.model,
  })

  const handleStopGeneration = useCallback(() => {
    stopAgentTurn()
    stopGeneration()
  }, [stopAgentTurn, stopGeneration])

  const handleSelectMessageVersion = useCallback(
    (message: Message, index: number) => {
      updateMessages((prev) =>
        prev.map((item) =>
          item.key === message.key ? setMessageActiveVersion(item, index) : item
        )
      )
    },
    [updateMessages]
  )

  const handleNewSession = useCallback(() => {
    handleEditOpenChange(false)
    startNewSession(activeModality)
  }, [activeModality, handleEditOpenChange, startNewSession])

  const { isLoadingModels } = usePlaygroundOptions({
    isAuthenticated,
    publicGroups,
    publicModels,
    currentGroup: config.group,
    currentModel: config.model,
    setGroups,
    setModels,
    updateConfig,
  })
  useEffect(() => {
    if (!search.model || appliedDeepLink.current === search.model) return
    if (!models.some((model) => model.value === search.model)) return
    appliedDeepLink.current = search.model
    const pricingModel = playgroundModels.find(
      (model) => model.model_name === search.model
    )
    const modality = getModelModality(
      pricingModel ?? { model_name: search.model }
    )
    selectStoreModel(search.model, undefined, { switchModality: modality })
  }, [models, playgroundModels, search.model, selectStoreModel])

  const selectedCatalogModel = playgroundModels.find(
    (model) => model.model_name === config.model
  )

  const chatModels = useMemo(
    () =>
      models.filter((option) => {
        const pricingModel = playgroundModels.find(
          (model) => model.model_name === option.value
        )
        return (
          getModelModality(pricingModel ?? { model_name: option.value }) ===
          'chat'
        )
      }),
    [models, playgroundModels]
  )

  const availableModalities = useMemo(() => {
    const found = new Set<StudioModality>()
    for (const option of models) {
      const pricingModel = playgroundModels.find(
        (model) => model.model_name === option.value
      )
      const modality = getModelModality(
        pricingModel ?? { model_name: option.value }
      )
      // Image modality only appears for GPT-format image models.
      if (modality === 'image' && !isPlaygroundImageModel(option.value)) {
        continue
      }
      found.add(modality)
    }
    return [...found]
  }, [models, playgroundModels])

  const selectModelByModality = useCallback(
    (modality: StudioModality, preferredPrompt?: string) => {
      // Prefer restoring the last session for this modality (and its model).
      setActiveModality(modality)

      const current = playgroundModels.find(
        (model) => model.model_name === config.model
      )
      const currentMatches =
        current != null && getModelModality(current) === modality
      if (!currentMatches) {
        const match = playgroundModels.find((model) => {
          if (!models.some((item) => item.value === model.model_name)) {
            return false
          }
          if (getModelModality(model) !== modality) return false
          if (
            modality === 'image' &&
            !isPlaygroundImageModel(model.model_name)
          ) {
            return false
          }
          return true
        })
        if (!match) {
          toast.error(t('No model available for this modality'), {
            description: t(
              'Try another template or wait until matching models load.'
            ),
          })
          return false
        }
        selectStoreModel(match.model_name, undefined, {
          switchModality: modality,
        })
      }

      if (preferredPrompt != null) {
        setPrefill(preferredPrompt)
      }
      return true
    },
    [
      config.model,
      models,
      playgroundModels,
      selectStoreModel,
      setActiveModality,
      setPrefill,
      t,
    ]
  )

  const catalog = (
    <ModelCatalog
      available={models}
      models={playgroundModels}
      selected={workspaceMode === 'duo' ? '' : config.model}
      loading={pricing.isLoading || isLoadingModels}
      error={Boolean(pricing.error)}
      onRetry={() => pricing.refetch()}
      onSelect={(model) => {
        const modality = getModelModality(model)
        selectStoreModel(model.model_name, undefined, {
          switchModality: modality,
        })
        setCatalogDrawerOpen(false)
      }}
      pinnedModels={pinnedModels}
      onTogglePin={togglePinnedModel}
      duoEnabled={workspaceMode === 'duo'}
      onOpenDuo={() => {
        selectDuo()
        setCatalogDrawerOpen(false)
      }}
    />
  )

  const duoActive = workspaceMode === 'duo'
  const desktopSettingsOpen = isWideDesktop
    ? settingsPanelOpen
    : narrowSettingsOpen
  const toggleSettings = () => {
    if (!isDesktop) {
      setSettingsSheetOpen(true)
      return
    }
    if (isWideDesktop) {
      setSettingsPanelOpen(!settingsPanelOpen)
      return
    }
    setNarrowSettingsOpen((open) => !open)
  }
  const closeDesktopSettings = () => {
    if (isWideDesktop) {
      setSettingsPanelOpen(false)
      return
    }
    setNarrowSettingsOpen(false)
  }

  return (
    <PlaygroundShell
      catalog={catalog}
      catalogOpen={catalogDrawerOpen}
      onCatalogOpenChange={setCatalogDrawerOpen}
      historyOpen={historyDrawerOpen}
      onHistoryOpenChange={setHistoryDrawerOpen}
      settings={
        <SettingsPanel
          modality={activeModality}
          duoActive={duoActive}
          open={desktopSettingsOpen}
          onClose={closeDesktopSettings}
        />
      }
    >
      <WorkspaceHeader
        model={config.model}
        pricingModel={selectedCatalogModel}
        group={config.group}
        mode={workspaceMode}
        modality={activeModality}
        sessionTitle={activeSession?.title}
        onOpenCatalog={() => {
          // Desktop keeps the catalog in the left rail; mobile uses a sheet.
          if (!isDesktop) setCatalogDrawerOpen(true)
        }}
        onOpenHistory={() => setHistoryDrawerOpen(true)}
        onNewSession={handleNewSession}
        actions={
          <Button
            size='icon'
            variant='ghost'
            className='text-muted-foreground hover:text-foreground size-9 touch-manipulation sm:size-8'
            aria-label={t('Settings')}
            aria-pressed={isDesktop ? desktopSettingsOpen : undefined}
            onClick={toggleSettings}
          >
            <SlidersHorizontal className='size-4' />
          </Button>
        }
      />

      {!duoActive && (
        <ModalityQuickSwitch
          active={activeModality}
          available={availableModalities}
          onSelect={(modality) => {
            selectModelByModality(modality)
          }}
        />
      )}

      {duoActive && (
        <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4 md:p-8'>
          <DuoWorkspace
            chatModels={chatModels}
            onClose={() => setWorkspaceMode('model')}
          />
        </div>
      )}

      {!duoActive && activeModality === 'chat' && (
        <div className='flex min-h-0 flex-1'>
          <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
            <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
              <PlaygroundChat
                messages={messages}
                isLoadingMessages={false}
                onRegenerateMessage={
                  agentChatEnabled ? undefined : handleRegenerateMessage
                }
                onEditMessage={agentChatEnabled ? undefined : handleEditMessage}
                onDeleteMessage={
                  agentChatEnabled ? undefined : handleDeleteMessage
                }
                onSelectMessageVersion={
                  agentChatEnabled ? undefined : handleSelectMessageVersion
                }
                onSelectPrompt={handleSendMessage}
                isGenerating={isGenerating || isAgentStreaming}
                editingKey={editingMessageKey}
                onCancelEdit={handleEditOpenChange}
                onSaveEdit={(newContent) => applyEdit(newContent, false)}
                onSaveEditAndSubmit={(newContent) =>
                  applyEdit(newContent, true)
                }
              />
              <ModelSwitchNotice />
            </div>
            <div className='playground-composer-dock mx-auto w-full max-w-4xl shrink-0 space-y-2 px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] sm:px-3 sm:pb-3 md:px-3 md:pb-4'>
              <ChatComposer
                allowAttachments={!agentChatEnabled}
                disabled={isGenerating || isRouting || isAgentStreaming}
                isGenerating={isGenerating || isAgentStreaming}
                isModelLoading={isLoadingModels}
                onOpenModelCatalog={() => setCatalogDrawerOpen(true)}
                onStop={handleStopGeneration}
                onSubmit={handleSendMessage}
              />
            </div>
          </div>
          <ArtifactPreviewPanel />
        </div>
      )}

      {!duoActive && activeModality !== 'chat' && (
        <div className='flex min-h-0 flex-1 flex-col'>
          <GenerationWorkspace
            modality={activeModality}
            pricingModel={selectedCatalogModel}
            canSubmit={requireAuthentication}
            studio={studio}
          />
        </div>
      )}

      <Sheet open={settingsSheetOpen} onOpenChange={setSettingsSheetOpen}>
        <SheetContent
          side='bottom'
          className='max-h-[min(88dvh,40rem)] overflow-y-auto rounded-t-2xl pb-[env(safe-area-inset-bottom,0px)]'
        >
          <div className='bg-border mx-auto mt-1 mb-1 h-1 w-10 rounded-full' />
          <SheetHeader>
            <SheetTitle>{t('Settings')}</SheetTitle>
          </SheetHeader>
          <div className='px-4 pb-5'>
            <SettingsSections modality={activeModality} duoActive={duoActive} />
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={signInDialogOpen}
        onOpenChange={setSignInDialogOpen}
        title={t('Sign in required')}
        description={t('Please sign in to send requests with AI models.')}
        contentClassName='sm:max-w-md'
        footer={
          <>
            <Button
              variant='outline'
              onClick={() => setSignInDialogOpen(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              onClick={() =>
                navigate({
                  to: '/sign-in',
                  search: { redirect: '/playground' },
                })
              }
            >
              {t('Sign in now')}
            </Button>
          </>
        }
      >
        <span />
      </Dialog>
    </PlaygroundShell>
  )
}
