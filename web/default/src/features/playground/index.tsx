/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Loader2, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { canTryInPlayground } from '@/features/pricing/lib/playground-eligibility'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { useAuthStore } from '@/stores/auth-store'

import { PlaygroundChat } from './components/chat/playground-chat'
import { PlaygroundInput } from './components/input/playground-input'
import { GenerationWorkspace } from './components/studio/generation-workspace'
import { ModelCatalog } from './components/studio/model-catalog'
import { TaskHistory } from './components/studio/task-history'
import { AgentsPanel } from './components/workbench/agents-panel'
import { ChatAdvancedTools } from './components/workbench/chat-advanced-tools'
import { ChatHistoryPanel } from './components/workbench/chat-history-panel'
import { DuoWorkspace } from './components/workbench/duo-workspace'
import { InspirationPanel } from './components/workbench/inspiration-panel'
import { WorkbenchShell } from './components/workbench/workbench-shell'
import {
  useChatHandler,
  usePlaygroundConversation,
  usePlaygroundOptions,
  usePlaygroundState,
} from './hooks'
import { useStudio } from './hooks/use-studio'
import { useWorkbenchPrefs } from './hooks/use-workbench-prefs'
import type { AgentCard } from './lib/workbench/agents-data'
import type { InspirationTemplate } from './lib/workbench/inspiration-data'
import type { WorkbenchTab } from './lib/workbench/workbench-prefs'
import { getModelModality } from './lib/studio/model-modality'
import type { StudioModality } from './types'

export function Playground() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const search = useSearch({ from: '/playground/' })
  const appliedDeepLink = useRef<string | undefined>(undefined)
  const user = useAuthStore((state) => state.auth.user)
  const isAuthenticated = Boolean(user)
  const [signInDialogOpen, setSignInDialogOpen] = useState(false)
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('models')
  const [duoOpen, setDuoOpen] = useState(false)
  const [prefillPrompt, setPrefillPrompt] = useState<string | undefined>()
  const [activeConversationId, setActiveConversationId] = useState<
    number | null
  >(null)
  const pricing = usePricingData('playground')
  const playgroundModels = useMemo(
    () =>
      pricing.isLegacyPlaygroundCatalog
        ? pricing.models
        : pricing.models.filter(canTryInPlayground),
    [pricing.isLegacyPlaygroundCatalog, pricing.models]
  )
  const studio = useStudio()
  const workbench = useWorkbenchPrefs()
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
  const {
    config,
    parameterEnabled,
    messages,
    isLoadingMessages,
    models,
    groups,
    updateMessages,
    setModels,
    setGroups,
    updateConfig,
    updateParameterEnabled,
    clearMessages,
  } = usePlaygroundState()

  const payloadOptions = useMemo(
    () => ({
      systemPrompt: workbench.prefs.chatTools.systemPrompt,
      carryHistory: workbench.prefs.chatTools.carryHistory,
      webSearch: workbench.prefs.chatTools.webSearch,
      maxToolLoops: workbench.prefs.chatTools.maxToolLoops,
    }),
    [
      workbench.prefs.chatTools.systemPrompt,
      workbench.prefs.chatTools.carryHistory,
      workbench.prefs.chatTools.webSearch,
      workbench.prefs.chatTools.maxToolLoops,
    ]
  )

  const { sendChat, stopGeneration, isGenerating } = useChatHandler({
    config,
    parameterEnabled,
    onMessageUpdate: updateMessages,
    payloadOptions,
  })

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
    canSubmit: requireAuthentication,
  })

  const handleClearMessages = () => {
    handleEditOpenChange(false)
    clearMessages()
  }

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
    updateConfig('model', search.model)
    setWorkbenchTab('models')
    setDuoOpen(false)
  }, [models, search.model, updateConfig])

  const selectedCatalogModel = playgroundModels.find(
    (model) => model.model_name === config.model
  )
  const activeModality = getModelModality(
    selectedCatalogModel ?? { model_name: config.model }
  )

  const chatModels = useMemo(
    () =>
      models.filter((option) => {
        const pricingModel = playgroundModels.find(
          (model) => model.model_name === option.value
        )
        return (
          getModelModality(
            pricingModel ?? { model_name: option.value }
          ) === 'chat'
        )
      }),
    [models, playgroundModels]
  )

  const selectModelByModality = useCallback(
    (modality: StudioModality, preferredPrompt?: string) => {
      const current = playgroundModels.find(
        (model) => model.model_name === config.model
      )
      const currentMatches =
        current != null && getModelModality(current) === modality
      const match =
        currentMatches
          ? current
          : playgroundModels.find(
              (model) =>
                models.some((item) => item.value === model.model_name) &&
                getModelModality(model) === modality
            )

      if (!match) {
        toast.error(t('No model available for this modality'), {
          description: t(
            'Try another template or wait until matching models load.'
          ),
        })
        return false
      }

      setWorkbenchTab('models')
      setDuoOpen(false)
      if (!currentMatches) {
        updateConfig('model', match.model_name)
      }
      if (preferredPrompt != null) {
        setPrefillPrompt(preferredPrompt)
      }
      return true
    },
    [config.model, models, playgroundModels, t, updateConfig]
  )

  const handleAgentSelect = useCallback(
    (agent: AgentCard) => {
      const action = agent.action
      if (action.type !== 'modality') return
      selectModelByModality(action.modality, action.prompt)
    },
    [selectModelByModality]
  )

  const handleApplyTemplate = useCallback(
    (template: InspirationTemplate) => {
      selectModelByModality(
        template.modality as StudioModality,
        template.prompt
      )
    },
    [selectModelByModality]
  )

  const handleApplyPrompt = useCallback(
    (prompt: string, modality: StudioModality) => {
      selectModelByModality(modality, prompt)
    },
    [selectModelByModality]
  )

  const pushRecentPrompt = workbench.pushRecentPrompt
  const handleChatSend = useCallback(
    (text: string) => {
      const ok = handleSendMessage(text)
      if (ok) {
        pushRecentPrompt({
          prompt: text,
          modality: 'chat',
          model: config.model,
        })
      }
      return ok
    },
    [config.model, handleSendMessage, pushRecentPrompt]
  )

  const studioPending =
    studio.imageMutation.isPending ||
    studio.videoMutation.isPending ||
    studio.audioMutation.isPending
  const showBusyStrip =
    workbenchTab !== 'models' && (isGenerating || studioPending)

  const catalog = (
    <ModelCatalog
      available={models}
      models={playgroundModels}
      selected={duoOpen ? '' : config.model}
      loading={pricing.isLoading || isLoadingModels}
      error={Boolean(pricing.error)}
      onRetry={() => pricing.refetch()}
      onSelect={(model) => {
        updateConfig('model', model.model_name)
        setDuoOpen(false)
        setWorkbenchTab('models')
      }}
      pinnedModels={workbench.prefs.pinnedModels}
      onTogglePin={workbench.togglePin}
      duoEnabled={duoOpen}
      onOpenDuo={() => {
        setDuoOpen(true)
        setWorkbenchTab('models')
        workbench.updateDuo({ enabled: true })
      }}
    />
  )

  const history =
    activeModality === 'chat' ? (
      <ChatHistoryPanel
        messages={messages}
        onClear={handleClearMessages}
        isAuthenticated={isAuthenticated}
        activeConversationId={activeConversationId}
        onConversationIdChange={setActiveConversationId}
        onLoadMessages={(loaded) => updateMessages(loaded)}
        model={config.model}
        group={config.group}
      />
    ) : (
      <TaskHistory
        isAuthenticated={isAuthenticated}
        highlightedTaskId={studio.video?.taskId}
        onSignIn={() => setSignInDialogOpen(true)}
        tone='workbench'
      />
    )

  const historyLabel =
    activeModality === 'chat' ? t('Chat history') : t('Task list')

  const showModelsWorkspace = workbenchTab === 'models'

  return (
    <WorkbenchShell
      tab={workbenchTab}
      onTabChange={(tab) => {
        setWorkbenchTab(tab)
        if (tab !== 'models') setDuoOpen(false)
      }}
      balance={user ? formatQuotaWithCurrency(user.quota) : undefined}
      onWalletClick={() => {
        if (requireAuthentication()) navigate({ to: '/wallet' })
      }}
      catalog={catalog}
      agents={
        <AgentsPanel onSelectAgent={handleAgentSelect} variant='rail' />
      }
      inspiration={
        <InspirationPanel
          variant='rail'
          myWorks={workbench.prefs.myWorks}
          recentPrompts={workbench.prefs.recentPrompts}
          onApplyTemplate={handleApplyTemplate}
          onApplyPrompt={handleApplyPrompt}
          onRemoveWork={workbench.removeWork}
        />
      }
      history={history}
      historyTriggerLabel={historyLabel}
      showHistoryTrigger={showModelsWorkspace}
    >
      {showBusyStrip && (
        <div className='flex shrink-0 items-center justify-between gap-3 border-b border-amber-400/20 bg-amber-400/10 px-3 py-2'>
          <p className='flex min-w-0 items-center gap-2 text-xs text-amber-100'>
            <Loader2 className='size-3.5 shrink-0 animate-spin' aria-hidden='true' />
            <span className='truncate'>
              {isGenerating
                ? t('Generation in progress…')
                : t('Studio task still running…')}
            </span>
          </p>
          <div className='flex shrink-0 items-center gap-1.5'>
            {isGenerating && (
              <Button
                size='sm'
                variant='outline'
                className='h-7 border-amber-300/30 bg-black/20 text-amber-50 hover:bg-black/40'
                onClick={stopGeneration}
              >
                <Square className='size-3 fill-current' />
                {t('Stop')}
              </Button>
            )}
            <Button
              size='sm'
              className='h-7 bg-cyan-500 text-zinc-950 hover:bg-cyan-400'
              onClick={() => setWorkbenchTab('models')}
            >
              {t('Back to Models')}
            </Button>
          </div>
        </div>
      )}

      {workbenchTab === 'agents' && (
        <AgentsPanel onSelectAgent={handleAgentSelect} variant='main' />
      )}

      {workbenchTab === 'inspiration' && (
        <InspirationPanel
          variant='main'
          myWorks={workbench.prefs.myWorks}
          recentPrompts={workbench.prefs.recentPrompts}
          onApplyTemplate={handleApplyTemplate}
          onApplyPrompt={handleApplyPrompt}
          onRemoveWork={workbench.removeWork}
        />
      )}

      {showModelsWorkspace && duoOpen && (
        <div className='min-h-0 flex-1 overflow-y-auto p-4 md:p-8'>
          <DuoWorkspace
            duo={workbench.prefs.duo}
            chatModels={chatModels}
            group={config.group}
            onChange={workbench.updateDuo}
            onClose={() => {
              setDuoOpen(false)
              workbench.updateDuo({ enabled: false })
            }}
          />
        </div>
      )}

      {showModelsWorkspace && !duoOpen && activeModality === 'chat' && (
        <>
          <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
            <PlaygroundChat
              messages={messages}
              isLoadingMessages={isLoadingMessages}
              onRegenerateMessage={handleRegenerateMessage}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessage}
              onSelectPrompt={handleChatSend}
              isGenerating={isGenerating}
              editingKey={editingMessageKey}
              onCancelEdit={handleEditOpenChange}
              onSaveEdit={(newContent) => applyEdit(newContent, false)}
              onSaveEditAndSubmit={(newContent) => applyEdit(newContent, true)}
            />
          </div>
          <div className='mx-auto w-full max-w-4xl shrink-0 space-y-2 px-2 pb-3 md:px-3 md:pb-4'>
            <ChatAdvancedTools
              tools={workbench.prefs.chatTools}
              onToolsChange={workbench.updateChatTools}
            />
            <PlaygroundInput
              config={config}
              disabled={isGenerating}
              groups={groups}
              groupValue={config.group}
              isGenerating={isGenerating}
              isModelLoading={isLoadingModels}
              modelValue={config.model}
              models={models}
              onGroupChange={(value) => updateConfig('group', value)}
              onConfigChange={updateConfig}
              onClearMessages={handleClearMessages}
              onModelChange={(value) => updateConfig('model', value)}
              onParameterEnabledChange={updateParameterEnabled}
              onStop={stopGeneration}
              onSubmit={handleChatSend}
              parameterEnabled={parameterEnabled}
              hasMessages={messages.length > 0}
              prefillText={
                activeModality === 'chat' ? prefillPrompt : undefined
              }
              onPrefillConsumed={() => setPrefillPrompt(undefined)}
            />
          </div>
        </>
      )}

      {showModelsWorkspace &&
        !duoOpen &&
        activeModality !== 'chat' && (
          <GenerationWorkspace
            modality={activeModality}
            model={config.model}
            pricingModel={selectedCatalogModel}
            group={config.group}
            groups={groups}
            onGroupChange={(value) => updateConfig('group', value)}
            settings={studio.settings}
            onSettingsChange={studio.setSettings}
            canSubmit={requireAuthentication}
            images={studio.images}
            video={studio.video}
            audioUrl={studio.audioUrl}
            imageMutation={studio.imageMutation}
            videoMutation={studio.videoMutation}
            audioMutation={studio.audioMutation}
            prefillPrompt={prefillPrompt}
            onPrefillConsumed={() => setPrefillPrompt(undefined)}
            onPromptUsed={(prompt) =>
              workbench.pushRecentPrompt({
                prompt,
                modality: activeModality,
                model: config.model,
              })
            }
            onSaveWork={workbench.saveWork}
          />
        )}

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
    </WorkbenchShell>
  )
}
