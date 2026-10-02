import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { LoadingState } from '@/components/loading-state'
import { useActiveChatKey } from '@/features/chat/hooks/use-active-chat-key'
import { useChatPresets } from '@/features/chat/hooks/use-chat-presets'
import { resolveChatUrl } from '@/features/chat/lib/chat-links'

export const Route = createFileRoute('/_authenticated/chat2link')({
  component: Chat2LinkPage,
})

function Chat2LinkPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { chatPresets, serverAddress } = useChatPresets()

  const firstWebPreset = useMemo(
    () => chatPresets.find((p) => p.type === 'web'),
    [chatPresets]
  )

  const { data: activeKey, error: keyError } = useActiveChatKey(
    Boolean(firstWebPreset)
  )

  useEffect(() => {
    if (!firstWebPreset) {
      if (chatPresets.length > 0) {
        toast.error(t('No available Web chat links'))
      }
      return
    }

    if (activeKey === undefined && !keyError) return

    if (keyError || !activeKey) {
      const message =
        keyError instanceof Error
          ? keyError.message
          : t('No enabled tokens available')
      toast.error(message)
      navigate({ to: '/keys' })
      return
    }

    const url = resolveChatUrl({
      template: firstWebPreset.url,
      apiKey: activeKey,
      serverAddress,
    })

    if (url) {
      window.location.href = url
    }
  }, [
    firstWebPreset,
    activeKey,
    keyError,
    serverAddress,
    chatPresets.length,
    navigate,
    t,
  ])

  return (
    <LoadingState
      className='h-full'
      message={t('Redirecting to chat page...')}
    />
  )
}
