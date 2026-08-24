import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { API_ENDPOINTS, ERROR_MESSAGES } from '../constants'
import {
  activateAgentMessageRevision,
  agentChatRequestBody,
  agentUIMessageToPlayground,
  attachmentFileParts,
  cancelAgentRun,
  deleteAgentMessage,
  editAgentMessage,
  loadAgentConversation,
  shouldPollAgentRun,
  type AgentChatToolMode,
  type AgentUIMessage,
} from '../lib/agent-chat/transport'
import { buildPlatformSystemPrompt } from '../lib/prompt/system-prompt'
import { VISUAL_OUTPUT_SYSTEM_PROMPT } from '../lib/streaming/payload-builder'
import { clampSystemPrompt } from '../lib/workbench/workbench-prefs'
import type {
  ChatAttachment,
  Message,
  PlaygroundConfig,
  PlaygroundReasoningLevel,
} from '../types'

type UseAgentChatOptions = {
  enabled: boolean
  chatId: string
  config: PlaygroundConfig
  systemPrompt?: string
  visualOutput?: boolean
  carryHistory?: boolean
  longMemory?: boolean
  maxSteps?: number
  toolMode?: AgentChatToolMode
  reasoning?: PlaygroundReasoningLevel
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

type PendingChatAcceptance = {
  resolve: (accepted: boolean) => void
  settled: boolean
}

function settleChatAcceptance(
  pending: PendingChatAcceptance | null,
  accepted: boolean
): void {
  if (!pending || pending.settled) return
  pending.settled = true
  pending.resolve(accepted)
}

export function useAgentChat(options: UseAgentChatOptions) {
  const { t } = useTranslation()
  const model = options.config.model
  const group = options.config.group
  const enabled = options.enabled
  const longMemory = options.longMemory
  const onConversationId = options.onConversationId
  const conversationIdRef = useRef(options.conversationId)
  const boundChatIdRef = useRef(options.chatId)
  const revisionRef = useRef(0)
  const runIdRef = useRef('')
  const chatRequestFailedRef = useRef(false)
  const chatAcceptanceRef = useRef<PendingChatAcceptance | null>(null)
  const [serverRunId, setServerRunId] = useState('')
  const loadGenerationRef = useRef(0)
  if (boundChatIdRef.current !== options.chatId) {
    boundChatIdRef.current = options.chatId
    conversationIdRef.current = options.conversationId
  } else if (options.conversationId !== undefined) {
    // Keep a response-header id long enough for the store binding callback to
    // publish it. An undefined draft prop must not clobber an accepted run.
    conversationIdRef.current = options.conversationId
  }

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
          let response: Response
          try {
            response = await fetch(url, init)
          } catch (error) {
            settleChatAcceptance(chatAcceptanceRef.current, false)
            chatAcceptanceRef.current = null
            throw error
          }
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
          // A run id means the turn and its attachments were committed before
          // a later context/model setup failure produced a non-2xx response.
          settleChatAcceptance(
            chatAcceptanceRef.current,
            response.ok || runId !== ''
          )
          chatAcceptanceRef.current = null
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
            body: agentChatRequestBody({
              conversationId: conversationIdRef.current,
              model,
              group,
              system,
              carryHistory: options.carryHistory !== false,
              longMemory: longMemory === true,
              maxSteps: Math.min(21, Math.max(1, options.maxSteps ?? 8)),
              toolMode: options.toolMode ?? 'auto',
              reasoning: options.reasoning,
              expectedRevision: messageId ? revisionRef.current : undefined,
              trigger,
              messageId,
              requestKey: crypto.randomUUID(),
              message,
            }),
          }
        },
      }),
    [
      group,
      longMemory,
      model,
      onConversationId,
      options.carryHistory,
      options.maxSteps,
      options.reasoning,
      options.toolMode,
      system,
    ]
  )

  const chat = useChat<AgentUIMessage>({
    id: options.chatId,
    transport,
    throttle: 50,
    onError: (error) => {
      chatRequestFailedRef.current = true
      toast.error(errorText(error) || t(ERROR_MESSAGES.API_REQUEST_ERROR))
    },
    onFinish: ({ isAbort, isDisconnect, isError }) => {
      if (isDisconnect || isError) {
        chatRequestFailedRef.current = true
        return
      }
      if (!isAbort) {
        // A clean AI SDK stream completion is authoritative for the local UI.
        // Durable polling remains active only for disconnects, where the
        // server intentionally continues the run without this browser.
        runIdRef.current = ''
        setServerRunId('')
      }
    },
  })
  const chatMessages = chat.messages
  const chatRegenerate = chat.regenerate
  const chatSendMessage = chat.sendMessage
  const chatSetMessages = chat.setMessages
  const chatStatus = chat.status
  const chatStop = chat.stop

  const isLocalStreaming =
    chatStatus === 'submitted' || chatStatus === 'streaming'
  const isAgentStreaming = isLocalStreaming || serverRunId !== ''

  const refreshAgentConversation = useCallback(
    async (silent = false) => {
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
        if (!silent) {
          toast.error(errorText(error) || t(ERROR_MESSAGES.API_REQUEST_ERROR))
        }
      }
    },
    [chatSetMessages, enabled, t]
  )

  useEffect(() => {
    runIdRef.current = ''
    setServerRunId('')
    return () => {
      settleChatAcceptance(chatAcceptanceRef.current, false)
      chatAcceptanceRef.current = null
    }
  }, [options.chatId])

  useEffect(() => {
    if (isLocalStreaming || serverRunId !== '') return
    void refreshAgentConversation()
  }, [
    isLocalStreaming,
    options.chatId,
    options.conversationId,
    refreshAgentConversation,
    serverRunId,
  ])

  useEffect(() => {
    if (!enabled || !shouldPollAgentRun(chatStatus, serverRunId)) return
    let cancelled = false
    let timer = 0
    const poll = async () => {
      await refreshAgentConversation(true)
      if (!cancelled) timer = window.setTimeout(poll, 1_500)
    }
    timer = window.setTimeout(poll, 500)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [chatStatus, enabled, refreshAgentConversation, serverRunId])

  useEffect(() => {
    if (!options.enabled) return
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible' && !isLocalStreaming) {
        void refreshAgentConversation()
      }
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [isLocalStreaming, options.enabled, refreshAgentConversation])

  const runAndRefresh = useCallback(
    async (
      operation: () => Promise<void>,
      trackChatRequest = false
    ): Promise<boolean> => {
      if (trackChatRequest) chatRequestFailedRef.current = false
      try {
        await operation()
        await refreshAgentConversation()
        return !trackChatRequest || !chatRequestFailedRef.current
      } catch (error) {
        toast.error(errorText(error) || t(ERROR_MESSAGES.API_REQUEST_ERROR))
        await refreshAgentConversation()
        return false
      }
    },
    [refreshAgentConversation, t]
  )

  const startChatRequest = useCallback(
    (operation: () => Promise<void>): Promise<boolean> => {
      settleChatAcceptance(chatAcceptanceRef.current, false)
      let resolveAcceptance: (accepted: boolean) => void = () => {}
      const accepted = new Promise<boolean>((resolve) => {
        resolveAcceptance = resolve
      })
      const pending: PendingChatAcceptance = {
        resolve: resolveAcceptance,
        settled: false,
      }
      chatAcceptanceRef.current = pending
      void runAndRefresh(operation, true).then((succeeded) => {
        if (!succeeded) settleChatAcceptance(pending, false)
        if (chatAcceptanceRef.current === pending && pending.settled) {
          chatAcceptanceRef.current = null
        }
      })
      return accepted
    },
    [runAndRefresh]
  )

  const sendAgentTurn = useCallback(
    async (text: string, attachments?: ChatAttachment[]): Promise<boolean> => {
      if (!enabled || isAgentStreaming) return false
      try {
        const files = attachmentFileParts(attachments)
        return startChatRequest(() => chatSendMessage({ text, files }))
      } catch (error) {
        toast.error(errorText(error))
        return false
      }
    },
    [chatSendMessage, enabled, isAgentStreaming, startChatRequest]
  )

  const regenerateAgentMessage = useCallback(
    (message: Message) => {
      if (!enabled || isAgentStreaming) return
      void runAndRefresh(() => chatRegenerate({ messageId: message.key }), true)
    },
    [chatRegenerate, enabled, isAgentStreaming, runAndRefresh]
  )

  const saveAgentMessage = useCallback(
    async (
      message: Message,
      content: string,
      attachments: ChatAttachment[] | undefined,
      shouldSubmit: boolean
    ): Promise<boolean> => {
      if (!enabled || isAgentStreaming) return false
      if (shouldSubmit && message.from === 'user') {
        try {
          const files = attachmentFileParts(attachments)
          return startChatRequest(() =>
            chatSendMessage({
              text: content,
              files,
              messageId: message.key,
            })
          )
        } catch (error) {
          toast.error(errorText(error))
          return false
        }
      }
      const conversationId = conversationIdRef.current
      if (!conversationId) return false
      return runAndRefresh(async () => {
        revisionRef.current = await editAgentMessage(
          conversationId,
          message,
          content,
          attachments,
          revisionRef.current
        )
      })
    },
    [
      chatSendMessage,
      enabled,
      isAgentStreaming,
      runAndRefresh,
      startChatRequest,
    ]
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
    return chatMessages.map((message, index) =>
      agentUIMessageToPlayground(
        message,
        isAgentStreaming && index === chatMessages.length - 1
      )
    )
  }, [chatMessages, isAgentStreaming])

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
