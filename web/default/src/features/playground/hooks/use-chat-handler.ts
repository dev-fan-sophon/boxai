import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { sendChatCompletion } from '../api'
import { ERROR_MESSAGES } from '../constants'
import {
  applyStreamingChunk,
  buildChatCompletionPayload,
  updateAssistantMessageWithError,
  updateLastAssistantMessage,
  parseRequestErrorDetails,
  applyChatCompletionResponse,
  completeAssistantMessage,
  hasChatCompletionChoice,
  isAssistantMessageFinal,
  isAssistantMessagePending,
} from '../lib'
import { hydrateMessageAttachments } from '../lib/attachments/attachment-assets'
import {
  isChatCompletionPayloadTooLarge,
  type BuildChatPayloadOptions,
} from '../lib/streaming/payload-builder'
import type { StreamMessageUpdate } from '../lib/streaming/stream-utils'
import {
  accumulateToolCallDeltas,
  buildWebSearchFollowupMessages,
  extractWebSearchCall,
  type ExtractedWebSearchCall,
} from '../lib/streaming/web-search-tool'
import type {
  ChatCompletionMessage,
  ChatToolCallDelta,
  ManagedToolCard,
  Message,
  MessageTokenUsage,
  PlaygroundConfig,
  ParameterEnabled,
} from '../types'
import { useStreamRequest } from './use-stream-request'

/**
 * Gateway-side executor for the model-invoked web_search function tool.
 * `execute` runs the platform-managed search and returns the answer text the
 * model continues from; the UI only shows that a search happened.
 */
export type WebSearchToolRunner = {
  maxLoops: number
  execute: (query: string) => Promise<{ runId?: number; text: string }>
}

interface UseChatHandlerOptions {
  config: PlaygroundConfig
  parameterEnabled: ParameterEnabled
  onMessageUpdate: (updater: (prev: Message[]) => Message[]) => void
  /** Optional workbench chat tool preferences applied to request payload */
  payloadOptions?: BuildChatPayloadOptions
  webSearchTool?: WebSearchToolRunner
}

const KNOWN_ERROR_MESSAGES = new Set<string>(Object.values(ERROR_MESSAGES))
const STREAM_UPDATE_FLUSH_MS = 50

/** Model-facing continuation when a search could not run; not shown in the UI. */
const WEB_SEARCH_FAILED_RESULT =
  'The web search could not be completed. Answer from what you already know and mention that live search was unavailable.'

type PendingStreamChunks = {
  content: string
  reasoning: string
  usage?: MessageTokenUsage
}

/**
 * One request/response round of an assistant turn. `extras` carries the
 * API-only tool-call transcript accumulated across web-search loops.
 */
type ChatTurn = {
  hydrated: Message[]
  extras: ChatCompletionMessage[]
  loops: number
}

function mergePendingStreamChunk(
  currentChunk: string,
  nextChunk: string
): string {
  if (!currentChunk || !nextChunk.startsWith(currentChunk)) {
    return currentChunk + nextChunk
  }

  return nextChunk
}

/** Sums per-round usage so a multi-search turn reports what it really cost. */
function addTokenUsage(
  base: MessageTokenUsage | null,
  usage: MessageTokenUsage
): MessageTokenUsage {
  if (!base) return usage
  return {
    promptTokens: base.promptTokens + usage.promptTokens,
    completionTokens: base.completionTokens + usage.completionTokens,
    totalTokens: base.totalTokens + usage.totalTokens,
  }
}

/**
 * Hook for handling chat message sending and receiving
 */
export function useChatHandler({
  config,
  parameterEnabled,
  onMessageUpdate,
  payloadOptions,
  webSearchTool,
}: UseChatHandlerOptions) {
  const { t } = useTranslation()
  const { sendStreamRequest, stopStream, isStreaming } = useStreamRequest()
  const [isRequesting, setIsRequesting] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  // Invalidates in-flight turns (including awaited search executions) when the
  // user stops generation or starts a new turn.
  const turnTokenRef = useRef(0)
  const activeTurnRef = useRef<ChatTurn | null>(null)
  const pendingToolCallDeltasRef = useRef<ChatToolCallDelta[]>([])
  const runStreamTurnRef = useRef<(turn: ChatTurn, withTools: boolean) => void>(
    () => {}
  )
  const runNonStreamingTurnRef = useRef<
    (turn: ChatTurn, withTools: boolean, token: number) => Promise<void>
  >(async () => {})
  const pendingStreamChunksRef = useRef<PendingStreamChunks>({
    content: '',
    reasoning: '',
  })
  const streamFlushTimerRef = useRef<number | null>(null)
  // Usage of finished loop rounds; the visible message shows base + current
  // round so a turn with searches reports the whole spend, not the last call.
  const turnUsageBaseRef = useRef<MessageTokenUsage | null>(null)
  const lastRoundUsageRef = useRef<MessageTokenUsage | null>(null)
  // Assistant text of the current round, echoed back in the tool-call
  // follow-up so the model does not repeat its own preamble.
  const roundContentRef = useRef('')

  const flushStreamUpdates = useCallback(() => {
    if (streamFlushTimerRef.current !== null) {
      window.clearTimeout(streamFlushTimerRef.current)
      streamFlushTimerRef.current = null
    }

    const pendingChunks = pendingStreamChunksRef.current
    if (
      !pendingChunks.reasoning &&
      !pendingChunks.content &&
      !pendingChunks.usage
    ) {
      return
    }

    pendingStreamChunksRef.current = { content: '', reasoning: '' }
    onMessageUpdate((prev) =>
      updateLastAssistantMessage(prev, (message) => {
        let updatedMessage = message

        if (pendingChunks.reasoning) {
          updatedMessage = applyStreamingChunk(
            updatedMessage,
            'reasoning',
            pendingChunks.reasoning
          )
        }

        if (pendingChunks.content) {
          updatedMessage = applyStreamingChunk(
            updatedMessage,
            'content',
            pendingChunks.content
          )
        }

        if (pendingChunks.usage) {
          updatedMessage = {
            ...updatedMessage,
            usage: addTokenUsage(turnUsageBaseRef.current, pendingChunks.usage),
          }
        }

        return updatedMessage
      })
    )
  }, [onMessageUpdate])

  const scheduleStreamFlush = useCallback(() => {
    if (streamFlushTimerRef.current !== null) {
      return
    }

    streamFlushTimerRef.current = window.setTimeout(
      flushStreamUpdates,
      STREAM_UPDATE_FLUSH_MS
    )
  }, [flushStreamUpdates])

  useEffect(
    () => () => {
      if (streamFlushTimerRef.current !== null) {
        window.clearTimeout(streamFlushTimerRef.current)
      }
    },
    []
  )

  const getDisplayError = useCallback(
    (error: string) => {
      if (KNOWN_ERROR_MESSAGES.has(error)) {
        return t(error)
      }

      const connectionClosedSuffix = `: ${ERROR_MESSAGES.CONNECTION_CLOSED}`
      if (error.endsWith(connectionClosedSuffix)) {
        return `${error.slice(0, -ERROR_MESSAGES.CONNECTION_CLOSED.length)}${t(
          ERROR_MESSAGES.CONNECTION_CLOSED
        )}`
      }

      return error
    },
    [t]
  )

  // Handle stream update
  const handleStreamUpdate = useCallback(
    (update: StreamMessageUpdate) => {
      if (update.type === 'tool_calls') {
        pendingToolCallDeltasRef.current.push(...update.deltas)
        return
      }
      if (update.type === 'usage') {
        pendingStreamChunksRef.current.usage = update.usage
        lastRoundUsageRef.current = update.usage
      } else {
        pendingStreamChunksRef.current[update.type] = mergePendingStreamChunk(
          pendingStreamChunksRef.current[update.type],
          update.chunk
        )
        if (update.type === 'content') {
          roundContentRef.current = mergePendingStreamChunk(
            roundContentRef.current,
            update.chunk
          )
        }
      }
      scheduleStreamFlush()
    },
    [scheduleStreamFlush]
  )

  const finalizeAssistantTurn = useCallback(() => {
    activeTurnRef.current = null
    setIsRequesting(false)
    onMessageUpdate((prev) =>
      updateLastAssistantMessage(prev, (message) =>
        isAssistantMessageFinal(message)
          ? message
          : completeAssistantMessage(message)
      )
    )
  }, [onMessageUpdate])

  const setWebSearchCard = useCallback(
    (card: ManagedToolCard) => {
      onMessageUpdate((prev) =>
        updateLastAssistantMessage(prev, (message) => ({
          ...message,
          managedTool: card,
        }))
      )
    },
    [onMessageUpdate]
  )

  const runWebSearchTurn = useCallback(
    async (
      turn: ChatTurn,
      extracted: ExtractedWebSearchCall,
      token: number,
      continueTurn: (nextTurn: ChatTurn, withTools: boolean) => void
    ) => {
      // Hard stop: even a provider that keeps emitting tool calls after the
      // tool was stripped must not drive endless billed searches.
      if (!webSearchTool || turn.loops >= webSearchTool.maxLoops) {
        finalizeAssistantTurn()
        return
      }
      const roundContent = roundContentRef.current
      roundContentRef.current = ''
      if (lastRoundUsageRef.current) {
        turnUsageBaseRef.current = addTokenUsage(
          turnUsageBaseRef.current,
          lastRoundUsageRef.current
        )
        lastRoundUsageRef.current = null
      }
      setWebSearchCard({ action: 'web_search', status: 'running' })
      let card: ManagedToolCard
      let resultText: string
      try {
        const result = await webSearchTool.execute(extracted.query)
        card = {
          action: 'web_search',
          status: 'completed',
          runId: result.runId,
        }
        resultText = result.text
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t('Tool failed')
        card = { action: 'web_search', status: 'failed', error: message }
        resultText = WEB_SEARCH_FAILED_RESULT
      }
      if (token !== turnTokenRef.current) return
      setWebSearchCard(card)
      const loops = turn.loops + 1
      continueTurn(
        {
          hydrated: turn.hydrated,
          extras: [
            ...turn.extras,
            ...buildWebSearchFollowupMessages(
              extracted.call,
              resultText,
              roundContent
            ),
          ],
          loops,
        },
        // Dropping the tool once the budget is spent forces a final answer.
        loops < webSearchTool.maxLoops
      )
    },
    [finalizeAssistantTurn, setWebSearchCard, t, webSearchTool]
  )

  // Handle stream error
  const handleStreamError = useCallback(
    (error: string, errorCode?: string) => {
      flushStreamUpdates()
      activeTurnRef.current = null
      setIsRequesting(false)
      const displayError = getDisplayError(error)
      toast.error(displayError)
      const errorTitle = t(ERROR_MESSAGES.API_REQUEST_ERROR)
      onMessageUpdate((prev) =>
        updateAssistantMessageWithError(
          prev,
          displayError,
          errorCode,
          errorTitle
        )
      )
    },
    [flushStreamUpdates, getDisplayError, onMessageUpdate, t]
  )

  // Handle stream complete; may continue the turn with a web-search loop
  const handleStreamComplete = useCallback(
    (token: number) => {
      flushStreamUpdates()
      const deltas = pendingToolCallDeltasRef.current
      pendingToolCallDeltasRef.current = []
      const turn = activeTurnRef.current
      if (
        webSearchTool &&
        turn &&
        token === turnTokenRef.current &&
        deltas.length > 0
      ) {
        const extracted = extractWebSearchCall(
          accumulateToolCallDeltas([], deltas)
        )
        if (extracted) {
          void runWebSearchTurn(turn, extracted, token, (nextTurn, withTools) =>
            runStreamTurnRef.current(nextTurn, withTools)
          )
          return
        }
      }
      finalizeAssistantTurn()
    },
    [finalizeAssistantTurn, flushStreamUpdates, runWebSearchTurn, webSearchTool]
  )

  const buildValidatedPayload = useCallback(
    (turn: ChatTurn, withTools: boolean) => {
      const payload = buildChatCompletionPayload(
        turn.hydrated,
        config,
        parameterEnabled,
        payloadOptions
      )
      if (turn.extras.length > 0) {
        payload.messages = [...payload.messages, ...turn.extras]
      }
      if (!withTools || !webSearchTool) {
        delete payload.tools
        delete payload.tool_choice
      }

      if (isChatCompletionPayloadTooLarge(payload)) {
        handleStreamError(ERROR_MESSAGES.REQUEST_TOO_LARGE)
        return null
      }

      return payload
    },
    [config, handleStreamError, parameterEnabled, payloadOptions, webSearchTool]
  )

  const runStreamTurn = useCallback(
    (turn: ChatTurn, withTools: boolean) => {
      const payload = buildValidatedPayload(turn, withTools)
      if (!payload) return

      activeTurnRef.current = turn
      pendingToolCallDeltasRef.current = []
      roundContentRef.current = ''
      const token = turnTokenRef.current
      setIsRequesting(true)
      sendStreamRequest(
        payload,
        handleStreamUpdate,
        () => handleStreamComplete(token),
        handleStreamError
      )
    },
    [
      buildValidatedPayload,
      sendStreamRequest,
      handleStreamUpdate,
      handleStreamComplete,
      handleStreamError,
    ]
  )

  // Send streaming chat request
  const sendStreamingChat = useCallback(
    async (messages: Message[]) => {
      const hydrated = await hydrateMessageAttachments(messages)
      turnTokenRef.current += 1
      turnUsageBaseRef.current = null
      lastRoundUsageRef.current = null
      runStreamTurn({ hydrated, extras: [], loops: 0 }, true)
    },
    [runStreamTurn]
  )

  const runNonStreamingTurn = useCallback(
    async (turn: ChatTurn, withTools: boolean, token: number) => {
      const payload = buildValidatedPayload(turn, withTools)
      if (!payload) return

      const abortController = new AbortController()
      abortControllerRef.current = abortController
      activeTurnRef.current = turn
      setIsRequesting(true)

      try {
        const response = await sendChatCompletion(
          payload,
          abortController.signal
        )
        if (abortController.signal.aborted || token !== turnTokenRef.current) {
          return
        }

        const responseMessage = response.choices?.[0]?.message
        const toolCalls = responseMessage?.tool_calls
        if (webSearchTool && toolCalls?.length) {
          const extracted = extractWebSearchCall(toolCalls)
          if (extracted) {
            roundContentRef.current =
              typeof responseMessage?.content === 'string'
                ? responseMessage.content
                : ''
            if (response.usage) {
              lastRoundUsageRef.current = {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
              }
            }
            await runWebSearchTurn(
              turn,
              extracted,
              token,
              (nextTurn, nextWithTools) =>
                void runNonStreamingTurnRef.current(
                  nextTurn,
                  nextWithTools,
                  token
                )
            )
            return
          }
        }

        if (!hasChatCompletionChoice(response)) {
          handleStreamError(ERROR_MESSAGES.API_REQUEST_ERROR)
          return
        }

        activeTurnRef.current = null
        setIsRequesting(false)
        onMessageUpdate((prev) =>
          updateLastAssistantMessage(prev, (message) => {
            const updatedMessage = applyChatCompletionResponse(
              message,
              response
            )
            if (!updatedMessage) return message
            if (turnUsageBaseRef.current && updatedMessage.usage) {
              return {
                ...updatedMessage,
                usage: addTokenUsage(
                  turnUsageBaseRef.current,
                  updatedMessage.usage
                ),
              }
            }

            return updatedMessage
          })
        )
      } catch (error: unknown) {
        if (abortController.signal.aborted) return

        const { errorCode, errorMessage } = parseRequestErrorDetails(error)
        handleStreamError(errorMessage, errorCode)
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null
        }
      }
    },
    [
      buildValidatedPayload,
      handleStreamError,
      onMessageUpdate,
      runWebSearchTurn,
      webSearchTool,
    ]
  )

  useEffect(() => {
    runStreamTurnRef.current = runStreamTurn
    runNonStreamingTurnRef.current = runNonStreamingTurn
  }, [runNonStreamingTurn, runStreamTurn])

  // Send non-streaming chat request
  const sendNonStreamingChat = useCallback(
    async (messages: Message[]) => {
      const hydrated = await hydrateMessageAttachments(messages)
      turnTokenRef.current += 1
      turnUsageBaseRef.current = null
      lastRoundUsageRef.current = null
      roundContentRef.current = ''
      await runNonStreamingTurn(
        { hydrated, extras: [], loops: 0 },
        true,
        turnTokenRef.current
      )
    },
    [runNonStreamingTurn]
  )

  // Send chat request (stream or non-stream based on config)
  const sendChat = useCallback(
    (messages: Message[]) => {
      if (config.stream) {
        void sendStreamingChat(messages)
      } else {
        void sendNonStreamingChat(messages)
      }
    },
    [config.stream, sendStreamingChat, sendNonStreamingChat]
  )

  // Stop generation
  const stopGeneration = useCallback(() => {
    turnTokenRef.current += 1
    activeTurnRef.current = null
    pendingToolCallDeltasRef.current = []
    stopStream()
    flushStreamUpdates()
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsRequesting(false)
    onMessageUpdate((prev) =>
      updateLastAssistantMessage(prev, (message) => {
        // A search interrupted mid-flight must not leave its card spinning.
        const managedTool =
          message.managedTool?.action === 'web_search' &&
          message.managedTool.status === 'running'
            ? { ...message.managedTool, status: 'failed' as const }
            : message.managedTool
        const finalized = isAssistantMessagePending(message)
          ? completeAssistantMessage(message)
          : message
        if (managedTool === message.managedTool) return finalized
        return { ...finalized, managedTool }
      })
    )
  }, [stopStream, flushStreamUpdates, onMessageUpdate])

  return {
    sendChat,
    stopGeneration,
    isGenerating: isStreaming || isRequesting,
  }
}
