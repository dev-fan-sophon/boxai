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
import { Link } from '@tanstack/react-router'
import { History, Library, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { useAuthStore } from '@/stores/auth-store'

import { PlaygroundChat } from './components/chat/playground-chat'
import { PlaygroundInput } from './components/input/playground-input'
import { GenerationWorkspace } from './components/studio/generation-workspace'
import { ModelCatalog } from './components/studio/model-catalog'
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
  const user = useAuthStore((state) => state.auth.user)
  const pricing = usePricingData()
  const studio = useStudio()
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
  })

  const handleClearMessages = () => {
    handleEditOpenChange(false)
    clearMessages()
  }

  const { isLoadingModels } = usePlaygroundOptions({
    currentGroup: config.group,
    currentModel: config.model,
    setGroups,
    setModels,
    updateConfig,
  })
  const selectedCatalogModel = pricing.models.find(
    (model) => model.model_name === config.model
  )
  const activeModality = selectedCatalogModel
    ? getModelModality(selectedCatalogModel)
    : studio.modality

  const catalog = (
    <ModelCatalog
      available={models}
      models={pricing.models}
      selected={config.model}
      loading={pricing.isLoading || isLoadingModels}
      error={Boolean(pricing.error)}
      onRetry={() => pricing.refetch()}
      onSelect={(model, modality) => {
        updateConfig('model', model.model_name)
        studio.setModality(modality)
      }}
    />
  )

  return (
    <div className='bg-background relative flex size-full min-h-0 flex-col overflow-hidden'>
      <header className='flex h-14 shrink-0 items-center justify-between gap-3 border-b px-3 md:px-4'>
        <div className='flex min-w-0 items-center gap-2'>
          <div className='lg:hidden'>
            <Sheet>
              <SheetTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('Open model catalog')}
                  >
                    <Library className='size-4' />
                  </Button>
                }
              />
              <SheetContent side='left' className='w-[88%] p-0'>
                <SheetHeader className='sr-only'>
                  <SheetTitle>{t('Model catalog')}</SheetTitle>
                  <SheetDescription>
                    {t('Choose a model for your next run.')}
                  </SheetDescription>
                </SheetHeader>
                {catalog}
              </SheetContent>
            </Sheet>
          </div>
          <div className='min-w-0'>
            <p className='truncate text-sm font-semibold'>
              {config.model || t('Select a model')}
            </p>
            <p className='text-muted-foreground truncate text-xs capitalize'>
              {t(activeModality[0].toUpperCase() + activeModality.slice(1))} ·{' '}
              {config.group}
            </p>
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-1 md:gap-2'>
          <div className='hidden text-right sm:block'>
            <p className='text-muted-foreground text-xs'>
              {t('Available balance')}
            </p>
            <p className='text-sm font-medium tabular-nums'>
              {formatQuotaWithCurrency(user?.quota ?? 0)}
            </p>
          </div>
          <Button
            render={<Link to='/wallet' />}
            variant='outline'
            size='sm'
            aria-label={t('Wallet')}
          >
            <WalletCards className='size-4' />
            <span className='hidden sm:inline'>{t('Wallet')}</span>
          </Button>
          <div className='xl:hidden'>
            <Sheet>
              <SheetTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('Open task history')}
                  >
                    <History className='size-4' />
                  </Button>
                }
              />
              <SheetContent className='w-[88%] p-0'>
                <SheetHeader className='sr-only'>
                  <SheetTitle>{t('Task history')}</SheetTitle>
                  <SheetDescription>
                    {t('Video and media tasks update automatically.')}
                  </SheetDescription>
                </SheetHeader>
                <TaskHistory />
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
      <div className='grid min-h-0 flex-1 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_280px]'>
        <aside className='hidden min-h-0 border-r lg:block'>{catalog}</aside>
        <main className='flex min-h-0 min-w-0 flex-col overflow-hidden'>
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
                  onSaveEditAndSubmit={(newContent) =>
                    applyEdit(newContent, true)
                  }
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
              images={studio.images}
              video={studio.video}
              audioUrl={studio.audioUrl}
              imageMutation={studio.imageMutation}
              videoMutation={studio.videoMutation}
              audioMutation={studio.audioMutation}
            />
          )}
        </main>
        <aside className='hidden min-h-0 border-l xl:block'>
          <TaskHistory />
        </aside>
      </div>
    </div>
  )
}
