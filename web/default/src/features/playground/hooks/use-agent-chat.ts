import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { API_ENDPOINTS, ERROR_MESSAGES } from '../constants'
import {
  activateAgentMessageRevision,
  agentUIMessageToPlayground,
  attachmentFileParts,
  cancelAgentRun,
  deleteAgentMessage,
  editAgentMessage,
  loadAgentConversation,
  type AgentUIMessage,
} from '../lib/agent-chat/transport'
import { buildPlatformSystemPrompt } from '../lib/prompt/system-prompt'
import { VISUAL_OUTPUT_SYSTEM_PROMPT } from '../lib/streaming/payload-builder'
import { clampSystemPrompt } from '../lib/workbench/workbench-prefs'
import type { ChatAttachment, Message, PlaygroundConfig } from '../types'

type UseAgentChatOptions = {
  enabled: boolean
  chatId: string
  config: PlaygroundConfig
  systemPrompt?: string
  visualOutput?: boolean
  longMemory?: boolean
  conversationId?: number
  onConversationId: (conversationId: number) => void
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  try {
    const body = JSON.parse(error.message) as { message?: string }
    return body.message || error.message
  } catch {
    return error.message
  }
}

export function useAgentChat(options: UseAgentChatOptions) {
  const { t } = useTranslation()
  const model = options.config.model
  const group = options.config.group
  const enabled = options.enabled
  const longMemory = options.longMemory
  const onConversationId = options.onConversationId
  const conversationIdRef = useRef(options.conversationId)
  const revisionRef = useRef(0)
  const runIdRef = useRef('')
  const [serverRunId, setServerRunId] = useState('')
  const loadGenerationRef = useRef(0)
  conversationIdRef.current = options.conversationId

  const system = useMemo(() => {
    const persona = clampSystemPrompt(options.systemPrompt).trim()
    return [
      buildPlatformSystemPrompt({ modelName: model }),
      options.visualOutput ? VISUAL_OUTPUT_SYSTEM_PROMPT : '',
      persona,
    ]
      .filter(Boolean)
      .join('\n\n')
  }, [model, options.systemPrompt, options.visualOutput])

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AgentUIMessage>({
        api: API_ENDPOINTS.AGENT_CHAT,
        credentials: 'include',
        fetch: async (url, init) => {
          const response = await fetch(url, init)
          const conversationId = Number(
            response.headers.get('X-Conversation-Id')
          )
          if (Number.isSafeInteger(conversationId) && conversationId > 0) {
            conversationIdRef.current = conversationId
            onConversationId(conversationId)
          }
          const runId = response.headers.get('X-Agent-Run-Id') || ''
          runIdRef.current = runId
          if (runId) setServerRunId(runId)
          return response
        },
        prepareSendMessagesRequest: ({ messages, trigger, messageId }) => {
          let message: AgentUIMessage | undefined
          if (trigger === 'submit-message') {
            message = messageId
              ? messages.find((item) => item.id === messageId)
              : messages.at(-1)
          }
          return {
            body: {
              conversationId: conversationIdRef.current,
              model,
              group,
              system,
              longMemory: longMemory === true,
              source: 'web',
              trigger,
              messageId,
              requestKey: crypto.randomUUID(),
              message,
            },
          }
        },
      }),
    [group, longMemory, model, onConversationId, system]
  )

  const chat = useChat<AgentUIMessage>({
    id: options.chatId,
    transport,
    throttle: 50,
    onError: (error) => {
      toast.error(errorText(error) || t(ERROR_MESSAGES.API_REQUEST_ERROR))
    },
  })
  const chatMessages = chat.messages
  const chatRegenerate = chat.regenerate
  const chatSendMessage = chat.sendMessage
  const chatSetMessages = chat.setMessages
  const chatStatus = chat.status
  const chatStop = chat.stop

  const isAgentStreaming =
    chatStatus === 'submitted' ||
    chatStatus === 'streaming' ||
    serverRunId !== ''

  const refreshAgentConversation = useCallback(async () => {
    const generation = loadGenerationRef.current + 1
    loadGenerationRef.current = generation
    const conversationId = conversationIdRef.current
    if (!enabled || !conversationId) {
      revisionRef.current = 0
      runIdRef.current = ''
      setServerRunId('')
      chatSetMessages([])
      return
    }
    try {
      const loaded = await loadAgentConversation(conversationId)
      if (loadGenerationRef.current !== generation) return
      revisionRef.current = loaded.revision
      runIdRef.current = loaded.activeRunId
      setServerRunId(loaded.activeRunId)
      chatSetMessages(loaded.messages)
    } catch (error) {
      if (loadGenerationRef.current !== generation) return
      toast.error(errorText(error) || t(ERROR_MESSAGES.API_REQUEST_ERROR))
    }
  }, [chatSetMessages, enabled, t])

  useEffect(() => {
    runIdRef.current = ''
    setServerRunId('')
  }, [options.chatId])

  useEffect(() => {
    if (isAgentStreaming) return
    void refreshAgentConversation()
  }, [
    isAgentStreaming,
    options.chatId,
    options.conversationId,
    refreshAgentConversation,
  ])

  useEffect(() => {
    if (!options.enabled) return
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible' && !isAgentStreaming) {
        void refreshAgentConversation()
      }
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [isAgentStreaming, options.enabled, refreshAgentConversation])

  const runAndRefresh = useCallback(
    async (operation: () => Promise<void>) => {
      try {
        await operation()
        await refreshAgentConversation()
      } catch (error) {
        toast.error(errorText(error) || t(ERROR_MESSAGES.API_REQUEST_ERROR))
        await refreshAgentConversation()
      }
    },
    [refreshAgentConversation, t]
  )

  const sendAgentTurn = useCallback(
    (text: string, attachments?: ChatAttachment[]) => {
      if (!enabled || isAgentStreaming) return false
      try {
        const files = attachmentFileParts(attachments)
        void runAndRefresh(() => chatSendMessage({ text, files }))
        return true
      } catch (error) {
        toast.error(errorText(error))
        return false
      }
    },
    [chatSendMessage, enabled, isAgentStreaming, runAndRefresh]
  )

  const regenerateAgentMessage = useCallback(
    (message: Message) => {
      if (!enabled || isAgentStreaming) return
      void runAndRefresh(() => chatRegenerate({ messageId: message.key }))
    },
    [chatRegenerate, enabled, isAgentStreaming, runAndRefresh]
  )

  const saveAgentMessage = useCallback(
    (message: Message, content: string, shouldSubmit: boolean) => {
      if (!enabled || isAgentStreaming) return
      if (shouldSubmit && message.from === 'user') {
        try {
          const files = attachmentFileParts(message.attachments)
          void runAndRefresh(() =>
            chatSendMessage({
              text: content,
              files,
              messageId: message.key,
            })
          )
        } catch (error) {
          toast.error(errorText(error))
        }
        return
      }
      const conversationId = conversationIdRef.current
      if (!conversationId) return
      void runAndRefresh(async () => {
        revisionRef.current = await editAgentMessage(
          conversationId,
          message,
          content,
          revisionRef.current
        )
      })
    },
    [chatSendMessage, enabled, isAgentStreaming, runAndRefresh]
  )

  const removeAgentMessage = useCallback(
    (message: Message) => {
      const conversationId = conversationIdRef.current
      if (!enabled || isAgentStreaming || !conversationId) return
      void runAndRefresh(async () => {
        revisionRef.current = await deleteAgentMessage(
          conversationId,
          message.key,
          revisionRef.current
        )
      })
    },
    [enabled, isAgentStreaming, runAndRefresh]
  )

  const selectAgentMessageVersion = useCallback(
    (message: Message, index: number) => {
      const conversationId = conversationIdRef.current
      const revision = Number(message.versions[index]?.id)
      if (
        !enabled ||
        isAgentStreaming ||
        !conversationId ||
        !Number.isInteger(revision) ||
        revision <= 0
      ) {
        return
      }
      void runAndRefresh(async () => {
        revisionRef.current = await activateAgentMessageRevision(
          conversationId,
          message.key,
          revision,
          revisionRef.current
        )
      })
    },
    [enabled, isAgentStreaming, runAndRefresh]
  )

  const stopAgentTurn = useCallback(async () => {
    const conversationId = conversationIdRef.current
    const runId = runIdRef.current
    try {
      if (conversationId && runId) {
        await cancelAgentRun(conversationId, runId)
      }
    } catch (error) {
      toast.error(errorText(error) || t(ERROR_MESSAGES.API_REQUEST_ERROR))
    } finally {
      await chatStop()
      runIdRef.current = ''
      setServerRunId('')
      await refreshAgentConversation()
    }
  }, [chatStop, refreshAgentConversation, t])

  const messages = useMemo(() => {
    const projected = chatMessages.map((message, index) =>
      agentUIMessageToPlayground(
        message,
        isAgentStreaming && index === chatMessages.length - 1
      )
    )
    if (
      isAgentStreaming &&
      projected.length > 0 &&
      projected.at(-1)?.from === 'user'
    ) {
      projected.push({
        key: 'agent-loading',
        from: 'assistant',
        versions: [{ id: '1', content: '' }],
        status: 'loading',
        model,
        createdAt: Date.now(),
      })
    }
    return projected
  }, [chatMessages, isAgentStreaming, model])

  return {
    messages,
    sendAgentTurn,
    regenerateAgentMessage,
    saveAgentMessage,
    removeAgentMessage,
    selectAgentMessageVersion,
    stopAgentTurn,
    isAgentStreaming,
    refreshAgentConversation,
  }
}
