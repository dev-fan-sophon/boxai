import { convertToModelMessages, stepCountIs, streamText } from 'ai'
import type { ModelMessage, ToolSet, UIMessage } from 'ai'

import { userModel } from './provider'

/**
 * The engine is the only layer that touches the AI SDK's generation loop, so
 * a future orchestrator (graph runner, different SDK) replaces this file, not
 * the tools, context, or transport code around it.
 */

export type AgentRunInput = {
  userId: number
  modelId: string
  system?: string
  messages: UIMessage[]
  /** Prepended before the converted UI history, e.g. summary + memory blocks. */
  contextMessages?: ModelMessage[]
  tools?: ToolSet
  maxSteps?: number
  abortSignal?: AbortSignal
}

export async function runAgent(input: AgentRunInput) {
  return streamText({
    model: userModel(input.userId, input.modelId),
    system: input.system,
    messages: [
      ...(input.contextMessages ?? []),
      ...(await convertToModelMessages(input.messages)),
    ],
    tools: input.tools,
    stopWhen: stepCountIs(input.maxSteps ?? 8),
    abortSignal: input.abortSignal,
  })
}
