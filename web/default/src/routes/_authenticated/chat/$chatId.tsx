import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { MessageCircleWarning } from '@/components/icons'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { useActiveChatKey } from '@/features/chat/hooks/use-active-chat-key'
import { useChatPresets } from '@/features/chat/hooks/use-chat-presets'
import {
  chatLinkRequiresApiKey,
  resolveChatUrl,
} from '@/features/chat/lib/chat-links'

export const Route = createFileRoute('/_authenticated/chat/$chatId')({
  loader: async ({ params }) => {
    if (!Number.isInteger(Number(params.chatId))) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: ChatRouteComponent,
})

function ChatRouteComponent() {
  const { t } = useTranslation()
  const { chatId } = Route.useParams()
  const { chatPresets, serverAddress } = useChatPresets()
  const preset = useMemo(() => {
    const index = Number(chatId)
    if (!Number.isInteger(index)) return undefined
    return chatPresets[index]
  }, [chatId, chatPresets])

  const isWebLink = preset?.type === 'web'

  const requiresActiveKey = useMemo(() => {
    if (!preset || !isWebLink) return false
    return chatLinkRequiresApiKey(preset.url ?? '')
  }, [isWebLink, preset])

  const {
    data: activeKey,
    isPending,
    isError,
    error,
  } = useActiveChatKey(Boolean(preset && requiresActiveKey))

  const iframeSrc = useMemo(() => {
    if (!preset || !isWebLink) return ''
    if (requiresActiveKey && !activeKey) return ''
    return resolveChatUrl({
      template: preset.url,
      apiKey: requiresActiveKey ? activeKey : undefined,
      serverAddress,
    })
  }, [activeKey, isWebLink, preset, requiresActiveKey, serverAddress])

  if (!preset) {
    return (
      <div className='flex h-full items-center justify-center p-4 sm:p-6'>
        <EmptyState
          icon={MessageCircleWarning}
          title={t('Chat preset not found')}
          description={t(
            'The requested chat preset does not exist or has been removed.'
          )}
          action={
            <Button variant='outline' render={<Link to='/dashboard' />}>
              {t('Return to dashboard')}
            </Button>
          }
          className='w-full max-w-lg'
        />
      </div>
    )
  }

  if (!isWebLink) {
    return (
      <div className='flex h-full items-center justify-center p-4 sm:p-6'>
        <EmptyState
          icon={MessageCircleWarning}
          title={t('Use sidebar shortcut')}
          description={
            <>
              <span className='text-foreground font-medium break-words'>
                {preset.name}
              </span>{' '}
              {t(
                'opens in an external client. Trigger it from the sidebar or API key actions to launch the configured application.'
              )}
            </>
          }
          action={
            <Button variant='outline' render={<Link to='/dashboard' />}>
              {t('Return to dashboard')}
            </Button>
          }
          className='w-full max-w-lg'
        />
      </div>
    )
  }

  if (requiresActiveKey && isPending) {
    return (
      <LoadingState
        className='h-full'
        message={t('Preparing your chat link…')}
      />
    )
  }

  if (requiresActiveKey && (isError || !activeKey || !iframeSrc)) {
    const message =
      error instanceof Error
        ? error.message
        : t('Unable to generate chat link. Please check your API keys.')
    return (
      <div className='flex h-full items-center justify-center p-4 sm:p-6'>
        <ErrorState
          title={t('Unable to open chat')}
          description={message}
          action={
            <Button variant='outline' size='sm' render={<Link to='/keys' />}>
              {t('API Keys')}
            </Button>
          }
          className='w-full max-w-lg'
        />
      </div>
    )
  }

  if (!requiresActiveKey && !iframeSrc) {
    return (
      <div className='flex h-full items-center justify-center p-4 sm:p-6'>
        <ErrorState
          title={t('Unable to open chat')}
          description={t(
            'Unable to generate chat link. Please contact your administrator.'
          )}
          className='w-full max-w-lg'
        />
      </div>
    )
  }

  return (
    <iframe
      src={iframeSrc}
      key={iframeSrc}
      className='h-full w-full border-0'
      allow='camera; microphone'
      // Presets are admin-configured, and the third-party chat UIs they point
      // at need scripts plus their own storage to work at all. Pairing those
      // two defeats most of the sandbox, so what it still buys us is keeping
      // the frame from navigating the host page away from BoxAI.
      // eslint-disable-next-line react/iframe-missing-sandbox
      sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads'
      title={`Chat preset: ${preset.name}`}
    />
  )
}
