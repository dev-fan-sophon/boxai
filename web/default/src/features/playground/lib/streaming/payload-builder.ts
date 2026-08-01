import type {
  ChatCompletionMessage,
  ChatCompletionRequest,
  Message,
  PlaygroundConfig,
  ParameterEnabled,
} from '../../types'
import { formatMessageForAPI, isValidMessage } from '../message/message-utils'
import {
  buildMemoryBlock,
  buildPlatformSystemPrompt,
  buildSummaryBlock,
} from '../prompt/system-prompt'
import { clampSystemPrompt } from '../workbench/workbench-prefs'
import { WEB_SEARCH_TOOL_DEFINITION } from './web-search-tool'

export type BuildChatPayloadOptions = {
  /** Custom persona, layered after the always-on platform base prompt */
  systemPrompt?: string
  /** When false, only the latest user turn is sent (plus system prompt) */
  carryHistory?: boolean
  /** When true, appends the platform visual-output capability prompt */
  visualOutput?: boolean
  /** Engine display name surfaced in the platform base prompt */
  modelName?: string
  /** Long-term user memories injected when the user enabled long memory */
  memories?: string[]
  /**
   * Rolling server-side summary of turns up to and including the message whose
   * key equals summaryTailKey. When the tail key is found in the history, the
   * covered turns are dropped and replaced by the summary block.
   */
  summary?: string
  summaryTailKey?: string
  /**
   * Offers the platform web_search function tool so the model can decide to
   * search mid-conversation. Execution stays in the managed search run.
   */
  webSearchTool?: boolean
}

/**
 * Tells the model which rich Markdown fences the client can render.
 * Must stay in sync with the renderers in components/ai-elements
 * (chart-spec.ts, mermaid-diagram.tsx, html-preview-fence.tsx).
 */
export const VISUAL_OUTPUT_SYSTEM_PROMPT = [
  'When visual output communicates better than prose, use these Markdown fences; the client renders them:',
  '- ```chart — JSON {"type":"bar"|"line"|"area"|"pie","title"?,"xKey"?,"yKeys"?,"data":[{...}]} (max 500 rows) for numeric comparisons and trends.',
  '- ```mermaid — flowchart, sequence, state, ER, and gantt diagrams.',
  '- ```html — a self-contained interactive demo (inline CSS/JS only; rendered in a sandboxed iframe without network access).',
  '- ```svg — vector graphics.',
  'LaTeX math ($...$ or $$...$$) and GFM tables are also rendered. Otherwise reply normally.',
].join('\n')

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
  let activeSummary = ''
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
  } else if (options?.summary && options.summaryTailKey) {
    // Rolling-summary window: drop turns the server already summarized. When
    // the tail key is missing (edited/rewritten thread) keep full history.
    const tailIndex = sourceMessages.findIndex(
      (message) => message.key === options.summaryTailKey
    )
    if (tailIndex >= 0 && tailIndex < sourceMessages.length - 1) {
      sourceMessages = sourceMessages.slice(tailIndex + 1)
      activeSummary = options.summary
    }
  }

  const processedMessages: ChatCompletionMessage[] =
    sourceMessages.map(formatMessageForAPI)

  const personaPrompt = clampSystemPrompt(options?.systemPrompt).trim()
  const systemPrompt = [
    buildPlatformSystemPrompt({ modelName: options?.modelName }),
    options?.visualOutput ? VISUAL_OUTPUT_SYSTEM_PROMPT : '',
    personaPrompt,
    buildMemoryBlock(options?.memories ?? []),
    buildSummaryBlock(activeSummary),
  ]
    .filter(Boolean)
    .join('\n\n')
  processedMessages.unshift({
    role: 'system',
    content: systemPrompt,
  })

  const payload: ChatCompletionRequest = {
    model: config.model,
    group: config.group,
    messages: processedMessages,
    stream: config.stream,
  }

  if (config.stream) {
    payload.stream_options = { include_usage: true }
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

  if (options?.webSearchTool) {
    payload.tools = [WEB_SEARCH_TOOL_DEFINITION]
    payload.tool_choice = 'auto'
  }

  return payload
}
