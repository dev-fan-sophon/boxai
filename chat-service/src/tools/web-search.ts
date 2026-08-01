import { tool } from 'ai'
import { z } from 'zod'

import { webSearch } from '../gateway/client'
import type { ToolContext } from './index'

export function webSearchTool(context: ToolContext) {
  return tool({
    description:
      'Search the live web for current information: news, prices, events, ' +
      'or anything after your knowledge cutoff. Returns an answer with ' +
      'source links.',
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .max(2000)
        .describe('The search query, in the language of the expected sources'),
    }),
    execute: async ({ query }, options) => {
      const result = await webSearch(
        context.userId,
        { query, group: context.group },
        options?.abortSignal
      )
      return {
        text: result.text,
        sources: result.sources,
      }
    },
  })
}
