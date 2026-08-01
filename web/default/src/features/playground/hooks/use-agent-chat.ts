import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ERROR_MESSAGES } from '../constants'
import {
  applyStreamingChunk,
  completeAssistantMessage,
  completeReasoningTiming,
  isAssistantMessageFinal,
  isAssistantMessagePending,
  updateAssistantMessageWithError,
  updateLastAssistantMessage,
} from '../lib'
import { sendAgentChat } from '../lib/agent-chat/transport'
import { buildPlatformSystemPrompt } from '../lib/prompt/system-prompt'
import { VISUAL_OUTPUT_SYSTEM_PROMPT } from '../lib/streaming/payload-builder'
import { clampSystemPrompt } from '../lib/workbench/workbench-prefs'
import type { Message, PlaygroundConfig } from '../types'

const STREAM_UPDATE_FLUSH_MS = 50
const KNOWN_ERROR_MESSAGES = new Set<string>(Object.values(ERROR_MESSAGES))

type UseAgentChatOptions = {
  config: PlaygroundConfig
  onMessageUpdate: (updater: (prev: Message[]) => Message[]) => void
  /** Persona layer from the workbench; layered after the platform base prompt. */
  systemPrompt?: string
  visualOutput?: boolean
  longMemory?: boolean
  /** Server conversation id of the active thread, when it already exists. */
  conversationId?: number
  onConversationId: (conversationId: number) => void
}

/**
 * Drives one chat turn through the boxai-chat microservice. The server owns
 * history, memories, tool execution, and persistence; this hook only maps the
 * streamed UI message chunks onto the local assistant message.
 */
export function useAgentChat(options: UseAgentChatOptions) {
  const { t } = useTranslation()
  const [isAgentStreaming, setIsAgentStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const pendingRef = useRef({ content: '', reasoning: '' })
  const flushTimerRef = useRef<number | null>(null)
  const onMessageUpdate = options.onMessageUpdate

  const flushStreamUpdates = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    const pending = pendingRef.current
    if (!pending.content && !pending.reasoning) return
    pendingRef.current = { content: '', reasoning: '' }
    onMessageUpdate((previous) =>
      updateLastAssistantMessage(previous, (message) => {
        let updated = message
        if (pending.reasoning) {
          updated = applyStreamingChunk(updated, 'reasoning', pending.reasoning)
        }
        if (pending.content) {
          updated = applyStreamingChunk(updated, 'content', pending.content)
        }
        return updated
      })
    )
  }, [onMessageUpdate])

  const scheduleStreamFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return
    flushTimerRef.current = window.setTimeout(
      flushStreamUpdates,
      STREAM_UPDATE_FLUSH_MS
    )
  }, [flushStreamUpdates])

  useEffect(
    () => () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current)
      }
    },
    []
  )

  const sendAgentTurn = useCallback(
    async (turnMessages: Message[], text: string) => {
      const userMessage = [...turnMessages]
        .reverse()
        .find((message) => message.from === 'user')
      if (!userMessage) return

      const controller = new AbortController()
      abortRef.current = controller
      pendingRef.current = { content: '', reasoning: '' }
      setIsAgentStreaming(true)

      const persona = clampSystemPrompt(options.systemPrompt).trim()
      const system = [
        buildPlatformSystemPrompt({ modelName: options.config.model }),
        options.visualOutput ? VISUAL_OUTPUT_SYSTEM_PROMPT : '',
        persona,
      ]
        .filter(Boolean)
        .join('\n\n')

      try {
        await sendAgentChat({
          signal: controller.signal,
          request: {
            conversationId: options.conversationId,
            model: options.config.model,
            group: options.config.group,
            system,
            longMemory: options.longMemory === true,
            messageKey: userMessage.key,
            text,
          },
          callbacks: {
            onConversationId: options.onConversationId,
            onAssistantId: (messageId) =>
              onMessageUpdate((previous) =>
                updateLastAssistantMessage(previous, (message) =>
                  message.key === messageId
                    ? message
                    : { ...message, key: messageId }
                )
              ),
            onTextDelta: (delta) => {
              pendingRef.current.content += delta
              scheduleStreamFlush()
            },
            onReasoningDelta: (delta) => {
              pendingRef.current.reasoning += delta
              scheduleStreamFlush()
            },
            onReasoningEnd: () => {
              flushStreamUpdates()
              onMessageUpdate((previous) =>
                updateLastAssistantMessage(previous, (message) =>
                  completeReasoningTiming({
                    ...message,
                    isReasoningStreaming: false,
                  })
                )
              )
            },
            onToolCard: (card) => {
              flushStreamUpdates()
              onMessageUpdate((previous) =>
                updateLastAssistantMessage(previous, (message) => ({
                  ...message,
                  managedTool: card,
                }))
              )
            },
            onSources: (sources) =>
              onMessageUpdate((previous) =>
                updateLastAssistantMessage(previous, (message) => ({
                  ...message,
                  sources,
                }))
              ),
            onError: (errorMessage) => {
              flushStreamUpdates()
              // Transport-level failures are ERROR_MESSAGES keys; anything
              // else is a server message that is already user-readable.
              const displayError = KNOWN_ERROR_MESSAGES.has(errorMessage)
                ? t(errorMessage)
                : errorMessage
              toast.error(displayError)
              onMessageUpdate((previous) =>
                updateAssistantMessageWithError(
                  previous,
                  displayError,
                  undefined,
                  t(ERROR_MESSAGES.API_REQUEST_ERROR)
                )
              )
            },
          },
        })
      } finally {
        flushStreamUpdates()
        if (abortRef.current === controller) {
          abortRef.current = null
        }
        setIsAgentStreaming(false)
        onMessageUpdate((previous) =>
          updateLastAssistantMessage(previous, (message) =>
            isAssistantMessageFinal(message)
              ? message
              : completeAssistantMessage(message)
          )
        )
      }
    },
    [
      flushStreamUpdates,
      onMessageUpdate,
      options.config.group,
      options.config.model,
      options.conversationId,
      options.longMemory,
      options.onConversationId,
      options.systemPrompt,
      options.visualOutput,
      scheduleStreamFlush,
      t,
    ]
  )

  const stopAgentTurn = useCallback(() => {
    const controller = abortRef.current
    if (!controller) return
    abortRef.current = null
    controller.abort()
    flushStreamUpdates()
    setIsAgentStreaming(false)
    onMessageUpdate((previous) =>
      updateLastAssistantMessage(previous, (message) => {
        // A tool interrupted mid-flight must not leave its card spinning.
        const managedTool =
          message.managedTool?.status === 'running'
            ? { ...message.managedTool, status: 'failed' as const }
            : message.managedTool
        const finalized = isAssistantMessagePending(message)
          ? completeAssistantMessage(message)
          : message
        if (managedTool === message.managedTool) return finalized
        return { ...finalized, managedTool }
      })
    )
  }, [flushStreamUpdates, onMessageUpdate])

  return { sendAgentTurn, stopAgentTurn, isAgentStreaming }
}
