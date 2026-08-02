import { tool } from 'ai'
import { z } from 'zod'

import { webSearch } from '../gateway/client'
import type { ToolContext } from './index'

export function webSearchTool(context: ToolContext) {
  let resultPromise: ReturnType<typeof webSearch> | undefined
  return tool({
    description:
      'Search the live web for current information: news, prices, events, ' +
      'or anything after your knowledge cutoff. Combine all research topics ' +
      'into one comprehensive query and call this tool at most once per turn. ' +
      'Returns an answer with source links.',
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .max(2000)
        .describe('The search query, in the language of the expected sources'),
    }),
    execute: async ({ query }, options) => {
      // Some OpenAI-compatible models ignore parallel_tool_calls=false. Share
      // the first in-flight result so parallel calls cannot multiply latency
      // and billing for a single user turn.
      resultPromise ??= webSearch(
        context.userId,
        { query, group: context.group },
        options?.abortSignal
      )
      const result = await resultPromise
      return {
        text: result.text,
        sources: result.sources,
      }
    },
  })
}
