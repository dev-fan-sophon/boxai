import type {
  ChatCompletionMessage,
  ChatToolCall,
  ChatToolCallDelta,
  ChatToolDefinition,
} from '../../types'

export const WEB_SEARCH_TOOL_NAME = 'web_search'

/** Mirrors service.MaxPlaygroundSearchQueryRunes on the backend. */
export const MAX_WEB_SEARCH_QUERY_CHARS = 1500

/**
 * Function tool offered to any chat model. The call itself is executed by the
 * platform-managed search run, so the model only ever produces a query.
 */
export const WEB_SEARCH_TOOL_DEFINITION: ChatToolDefinition = {
  type: 'function',
  function: {
    name: WEB_SEARCH_TOOL_NAME,
    description:
      'Search the public web for current information. Use it when the answer depends on recent events, prices, releases, or facts you are not sure about.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A focused search query in the language of the topic.',
        },
      },
      required: ['query'],
    },
  },
}

/**
 * Merge streamed tool-call deltas into complete calls. Providers key deltas by
 * `index` and send `arguments` in fragments that must be concatenated.
 */
export function accumulateToolCallDeltas(
  calls: ChatToolCall[],
  deltas: ChatToolCallDelta[]
): ChatToolCall[] {
  const merged = [...calls]
  for (const delta of deltas) {
    const index = typeof delta.index === 'number' ? delta.index : 0
    while (merged.length <= index) {
      merged.push({
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
      })
    }
    const current = merged[index]
    merged[index] = {
      id: delta.id || current.id,
      type: 'function',
      function: {
        name: delta.function?.name || current.function.name,
        arguments:
          current.function.arguments + (delta.function?.arguments ?? ''),
      },
    }
  }
  return merged
}

export type ExtractedWebSearchCall = {
  call: ChatToolCall
  query: string
}

/**
 * Pick the first web_search call and parse its query. Returns null when the
 * model called something else or produced arguments we cannot trust.
 */
export function extractWebSearchCall(
  calls: ChatToolCall[]
): ExtractedWebSearchCall | null {
  const call = calls.find(
    (candidate) => candidate.function.name === WEB_SEARCH_TOOL_NAME
  )
  if (!call) return null
  let query = ''
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || '{}')
    if (parsed && typeof parsed === 'object') {
      const value = (parsed as Record<string, unknown>).query
      if (typeof value === 'string') query = value.trim()
    }
  } catch {
    return null
  }
  if (!query) return null
  query = [...query].slice(0, MAX_WEB_SEARCH_QUERY_CHARS).join('')
  return {
    // Some providers omit tool-call ids on streamed calls; the follow-up tool
    // message still needs one to pair with the assistant turn.
    call: { ...call, id: call.id || `${WEB_SEARCH_TOOL_NAME}_call` },
    query,
  }
}

/**
 * The two API-only messages appended after a search executes: the assistant
 * turn that requested the call (including any preamble text it already
 * streamed, so it does not repeat itself) and the tool result it continues
 * from.
 */
export function buildWebSearchFollowupMessages(
  call: ChatToolCall,
  resultText: string,
  assistantContent = ''
): ChatCompletionMessage[] {
  return [
    { role: 'assistant', content: assistantContent, tool_calls: [call] },
    { role: 'tool', content: resultText, tool_call_id: call.id },
  ]
}
