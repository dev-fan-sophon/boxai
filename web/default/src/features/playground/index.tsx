import { useNavigate, useSearch } from '@tanstack/react-router'
import { SlidersHorizontal } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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
  selectActiveSession,
  usePlaygroundStore,
} from '@/stores/playground-store'

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
import { STORAGE_KEYS } from './constants'
import {
  patchSessionById,
  usePlaygroundConversation,
  usePlaygroundOptions,
  useSessionCloudSync,
} from './hooks'
import { useAgentChat } from './hooks/use-agent-chat'
import { useStudio } from './hooks/use-studio'
import { useArtifactPreviewStore } from './lib/artifact-preview-store'
import { isChatSession } from './lib/session/session-utils'
import { isPlaygroundImageModel } from './lib/studio/image-request-schema'
import { getModelModality } from './lib/studio/model-modality'
import type {
  ChatAttachment,
  Message,
  PlaygroundConfig,
  PlaygroundReasoningLevel,
  StudioModality,
} from './types'

import './styles/playground.css'

export function Playground() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const search = useSearch({ from: '/_public/playground/' })
  const appliedDeepLink = useRef<string | undefined>(undefined)
  const user = useAuthStore((state) => state.auth.user)
  const isAuthenticated = Boolean(user)
  const currentUserId = user?.id ?? null
  const previousUserIdRef = useRef<number | null | undefined>(undefined)
  const [scopedUserId, setScopedUserId] = useState<number | null | undefined>(
    undefined
  )
  const [signInDialogOpen, setSignInDialogOpen] = useState(false)
  const [catalogDrawerOpen, setCatalogDrawerOpen] = useState(false)
  // Settings panel: persisted open state on wide desktop, ephemeral overlay
  // between 1024–1279px, bottom sheet below 1024px.
  const isDesktop = useLgUp()
  const isWideDesktop = useXlUp()
  const [narrowSettingsOpen, setNarrowSettingsOpen] = useState(false)
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false)
  const previewArtifact = useArtifactPreviewStore((state) => state.artifact)

  const workspaceMode = usePlaygroundStore((state) => state.workspaceMode)
  const setWorkspaceMode = usePlaygroundStore((state) => state.setWorkspaceMode)
  const activeModality = usePlaygroundStore((state) => state.activeModality)
  const setActiveModality = usePlaygroundStore(
    (state) => state.setActiveModality
  )
  const selectStoreModel = usePlaygroundStore((state) => state.selectModel)
  const selectDuo = usePlaygroundStore((state) => state.selectDuo)
  const startNewSession = usePlaygroundStore((state) => state.startNewSession)
  const resetAccountData = usePlaygroundStore((state) => state.resetAccountData)
  const setPrefill = usePlaygroundStore((state) => state.setPrefill)
  const settingsPanelOpen = usePlaygroundStore(
    (state) => state.ui.settingsPanelOpen
  )
  const setSettingsPanelOpen = usePlaygroundStore(
    (state) => state.setSettingsPanelOpen
  )
  useEffect(() => {
    if (!previewArtifact || !isDesktop) return
    setSettingsPanelOpen(false)
    setNarrowSettingsOpen(false)
  }, [isDesktop, previewArtifact, setSettingsPanelOpen])
  const chatTools = usePlaygroundStore((state) => state.chatTools)
  const pinnedModels = usePlaygroundStore((state) => state.pinnedModels)
  const togglePinnedModel = usePlaygroundStore(
    (state) => state.togglePinnedModel
  )
  const config = usePlaygroundStore((state) => state.config)
  const activeSession = usePlaygroundStore(selectActiveSession)
  const models = usePlaygroundStore((state) => state.models)
  const setModels = usePlaygroundStore((state) => state.setModels)
  const setGroups = usePlaygroundStore((state) => state.setGroups)
  const patchConfig = usePlaygroundStore((state) => state.updateConfig)
  const accountScopeReady = scopedUserId === currentUserId
  useLayoutEffect(() => {
    let previousOwner: string | null = null
    try {
      previousOwner = window.localStorage.getItem(STORAGE_KEYS.ACCOUNT_OWNER)
    } catch {
      // Storage may be unavailable; the in-memory identity still scopes data.
    }
    const currentOwner = currentUserId === null ? null : String(currentUserId)
    const identityChanged =
      previousUserIdRef.current !== undefined &&
      previousUserIdRef.current !== currentUserId
    const persistedOwnerChanged =
      currentOwner === null
        ? previousOwner !== null
        : previousOwner !== currentOwner
    if (identityChanged || persistedOwnerChanged) {
      resetAccountData()
      useArtifactPreviewStore.getState().close()
    }
    if (currentOwner !== null) {
      try {
        window.localStorage.setItem(STORAGE_KEYS.ACCOUNT_OWNER, currentOwner)
      } catch {
        // Storage may be unavailable.
      }
    } else if (previousOwner !== null) {
      try {
        window.localStorage.removeItem(STORAGE_KEYS.ACCOUNT_OWNER)
      } catch {
        // Storage may be unavailable.
      }
    }
    previousUserIdRef.current = currentUserId
    setScopedUserId(currentUserId)
  }, [currentUserId, resetAccountData])
  useSessionCloudSync(accountScopeReady ? user?.id : undefined)
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
        reasoningEfforts: model.reasoning_efforts,
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

  const activeChat =
    isChatSession(activeSession) && activeSession.kind !== 'duo'
      ? activeSession
      : undefined
  const activeChatId = activeChat?.id
  const selectedCatalogModel = playgroundModels.find(
    (model) => model.model_name === config.model
  )
  const configuredReasoning = config.reasoningByModel[config.model]
  let reasoning: PlaygroundReasoningLevel | undefined
  if (selectedCatalogModel?.reasoning_efforts?.length) {
    const isSupported =
      configuredReasoning === 'provider-default' ||
      selectedCatalogModel.reasoning_efforts.some(
        (effort) => effort === configuredReasoning
      )
    reasoning = isSupported ? configuredReasoning : 'provider-default'
  }
  const bindAgentConversation = useCallback(
    (conversationId: number) => {
      if (!activeChatId) return
      patchSessionById(activeChatId, {
        serverId: conversationId,
        isDraft: false,
        updatedAt: Date.now(),
      })
    },
    [activeChatId]
  )
  const {
    messages: agentMessages,
    sendAgentTurn,
    regenerateAgentMessage,
    saveAgentMessage,
    removeAgentMessage,
    selectAgentMessageVersion,
    stopAgentTurn,
    isAgentStreaming,
  } = useAgentChat({
    enabled: isAuthenticated && accountScopeReady,
    chatId: activeChatId || 'agent-draft',
    config,
    systemPrompt: chatTools.systemPrompt,
    visualOutput: chatTools.visualOutput,
    carryHistory: chatTools.carryHistory,
    longMemory: chatTools.longMemory,
    maxSteps: Math.min(21, chatTools.maxToolLoops + 1),
    toolMode: chatTools.mode,
    reasoning,
    conversationId: activeChat?.serverId,
    onConversationId: bindAgentConversation,
  })
  const sendAgentTurnAndUpdateSession = useCallback(
    async (text: string, attachments?: ChatAttachment[]) => {
      const accepted = await sendAgentTurn(text, attachments)
      if (!accepted || !activeChatId) return accepted
      const current = usePlaygroundStore
        .getState()
        .sessions.find((session) => session.id === activeChatId)
      if (
        current &&
        isChatSession(current) &&
        (current.title === 'New chat' ||
          current.title === 'Imported Playground chat')
      ) {
        const title = text.trim() || attachments?.[0]?.name.trim() || ''
        if (title) {
          patchSessionById(activeChatId, {
            title: title.slice(0, 48),
            isDraft: false,
            updatedAt: Date.now(),
          })
        }
      }
      return accepted
    },
    [activeChatId, sendAgentTurn]
  )
  // A preview opened in another conversation must not linger over the new one.
  useEffect(() => {
    useArtifactPreviewStore.getState().close()
  }, [activeSession?.id])

  const {
    editingMessageKey,
    handleSendMessage,
    handleRegenerateMessage,
    handleEditMessage,
    handleEditOpenChange,
    applyEdit,
    handleDeleteMessage,
  } = usePlaygroundConversation({
    messages: agentMessages,
    send: sendAgentTurnAndUpdateSession,
    regenerate: regenerateAgentMessage,
    save: saveAgentMessage,
    remove: removeAgentMessage,
    canSubmit: requireAuthentication,
  })

  const handleStopGeneration = useCallback(() => {
    void stopAgentTurn()
  }, [stopAgentTurn])

  const handleSelectMessageVersion = useCallback(
    (message: Message, index: number) => {
      selectAgentMessageVersion(message, index)
    },
    [selectAgentMessageVersion]
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
          hasActiveChatMessages:
            modality === 'chat' && agentMessages.length > 0,
        })
      }

      if (preferredPrompt != null) {
        setPrefill(preferredPrompt)
      }
      return true
    },
    [
      config.model,
      agentMessages.length,
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
          hasActiveChatMessages:
            modality === 'chat' && agentMessages.length > 0,
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
    useArtifactPreviewStore.getState().close()
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
                messages={agentMessages}
                isLoadingMessages={false}
                onRegenerateMessage={handleRegenerateMessage}
                onEditMessage={handleEditMessage}
                onDeleteMessage={handleDeleteMessage}
                onSelectMessageVersion={handleSelectMessageVersion}
                onSelectPrompt={handleSendMessage}
                isGenerating={isAgentStreaming}
                editingKey={editingMessageKey}
                onCancelEdit={handleEditOpenChange}
                onSaveEdit={(newContent, attachments) =>
                  applyEdit(newContent, attachments, false)
                }
                onSaveEditAndSubmit={(newContent, attachments) =>
                  applyEdit(newContent, attachments, true)
                }
              />
              <ModelSwitchNotice />
            </div>
            <div className='playground-composer-dock mx-auto w-full max-w-4xl shrink-0 space-y-2 px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] sm:px-3 sm:pb-3 md:px-3 md:pb-4'>
              <ChatComposer
                key={`${scopedUserId ?? 'guest'}:${activeChatId ?? 'draft'}`}
                allowAttachments
                disabled={isAgentStreaming}
                isGenerating={isAgentStreaming}
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
