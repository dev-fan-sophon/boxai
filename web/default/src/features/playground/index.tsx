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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
import { StudioShell } from './components/studio/studio-shell'
import { TaskHistory } from './components/studio/task-history'
import {
  useChatHandler,
  usePlaygroundConversation,
  usePlaygroundOptions,
  usePlaygroundState,
} from './hooks'
import { useStudio } from './hooks/use-studio'
import { getModelModality } from './lib/studio/model-modality'

export function Playground() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const search = useSearch({ from: '/playground/' })
  const appliedDeepLink = useRef<string | undefined>(undefined)
  const user = useAuthStore((state) => state.auth.user)
  const isAuthenticated = Boolean(user)
  const [signInDialogOpen, setSignInDialogOpen] = useState(false)
  const pricing = usePricingData('playground')
  const playgroundModels = useMemo(
    () =>
      pricing.isLegacyPlaygroundCatalog
        ? pricing.models
        : pricing.models.filter(canTryInPlayground),
    [pricing.isLegacyPlaygroundCatalog, pricing.models]
  )
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

  const { sendChat, stopGeneration, isGenerating } = useChatHandler({
    config,
    parameterEnabled,
    onMessageUpdate: updateMessages,
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
  }, [models, search.model, updateConfig])
  const selectedCatalogModel = playgroundModels.find(
    (model) => model.model_name === config.model
  )
  const activeModality = getModelModality(
    selectedCatalogModel ?? { model_name: config.model }
  )

  const catalog = (
    <ModelCatalog
      available={models}
      models={playgroundModels}
      selected={config.model}
      loading={pricing.isLoading || isLoadingModels}
      error={Boolean(pricing.error)}
      onRetry={() => pricing.refetch()}
      onSelect={(model) => {
        updateConfig('model', model.model_name)
      }}
    />
  )

  return (
    <StudioShell
      model={selectedCatalogModel}
      modelName={config.model}
      modality={activeModality}
      group={config.group}
      balance={user ? formatQuotaWithCurrency(user.quota) : undefined}
      onWalletClick={() => {
        if (requireAuthentication()) navigate({ to: '/wallet' })
      }}
      catalog={catalog}
      history={
        <TaskHistory
          isAuthenticated={isAuthenticated}
          highlightedTaskId={studio.video?.taskId}
          onSignIn={() => setSignInDialogOpen(true)}
        />
      }
    >
      {activeModality === 'chat' ? (
        <>
          <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
            <PlaygroundChat
              messages={messages}
              isLoadingMessages={isLoadingMessages}
              onRegenerateMessage={handleRegenerateMessage}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessage}
              onSelectPrompt={handleSendMessage}
              isGenerating={isGenerating}
              editingKey={editingMessageKey}
              onCancelEdit={handleEditOpenChange}
              onSaveEdit={(newContent) => applyEdit(newContent, false)}
              onSaveEditAndSubmit={(newContent) => applyEdit(newContent, true)}
            />
          </div>
          <div className='mx-auto w-full max-w-4xl'>
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
              onSubmit={handleSendMessage}
              parameterEnabled={parameterEnabled}
              hasMessages={messages.length > 0}
            />
          </div>
        </>
      ) : (
        <GenerationWorkspace
          modality={activeModality}
          model={config.model}
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
    </StudioShell>
  )
}
