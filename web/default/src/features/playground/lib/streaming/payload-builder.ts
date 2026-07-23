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
import type {
  ChatCompletionMessage,
  ChatCompletionRequest,
  Message,
  PlaygroundConfig,
  ParameterEnabled,
} from '../../types'
import { formatMessageForAPI, isValidMessage } from '../message/message-utils'
import { clampSystemPrompt } from '../workbench/workbench-prefs'

export type BuildChatPayloadOptions = {
  /** Prepended as a system message when non-empty */
  systemPrompt?: string
  /** When false, only the latest user turn is sent (plus system prompt) */
  carryHistory?: boolean
  /** Server-side web search pre-pass when configured */
  webSearch?: boolean
  maxToolLoops?: number
  managedToolRunId?: number
}

export const MAX_CHAT_PAYLOAD_BYTES = 30 * 1024 * 1024

export function isChatCompletionPayloadTooLarge(
  payload: ChatCompletionRequest
): boolean {
  return (
    new TextEncoder().encode(JSON.stringify(payload)).byteLength >
    MAX_CHAT_PAYLOAD_BYTES
  )
}

/**
 * Build API request payload from messages and config
 */
export function buildChatCompletionPayload(
  messages: Message[],
  config: PlaygroundConfig,
  parameterEnabled: ParameterEnabled,
  options?: BuildChatPayloadOptions
): ChatCompletionRequest {
  // Filter and format valid messages
  let sourceMessages = messages.filter(isValidMessage)
  if (options?.carryHistory === false) {
    // Keep the last user message only (and any trailing assistant is not needed for request)
    const lastUserIndex = [...sourceMessages]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find((entry) => entry.message.from === 'user')?.index
    sourceMessages =
      lastUserIndex === undefined
        ? []
        : sourceMessages.slice(lastUserIndex, lastUserIndex + 1)
  }

  const processedMessages: ChatCompletionMessage[] =
    sourceMessages.map(formatMessageForAPI)

  const systemPrompt = clampSystemPrompt(options?.systemPrompt).trim()
  if (systemPrompt) {
    processedMessages.unshift({
      role: 'system',
      content: systemPrompt,
    })
  }

  const payload: ChatCompletionRequest = {
    model: config.model,
    group: config.group,
    messages: processedMessages,
    stream: config.stream,
  }

  if (parameterEnabled.temperature) {
    payload.temperature = config.temperature
  }

  if (parameterEnabled.top_p) {
    payload.top_p = config.top_p
  }

  if (parameterEnabled.max_tokens) {
    payload.max_tokens = config.max_tokens
  }

  if (parameterEnabled.frequency_penalty) {
    payload.frequency_penalty = config.frequency_penalty
  }

  if (parameterEnabled.presence_penalty) {
    payload.presence_penalty = config.presence_penalty
  }

  if (parameterEnabled.seed && config.seed !== null) {
    payload.seed = config.seed
  }

  if (options?.managedToolRunId) {
    payload.managed_tool_run_id = options.managedToolRunId
  } else if (options?.webSearch) {
    payload.web_search = true
    payload.max_tool_loops = options.maxToolLoops ?? 3
  }

  return payload
}
