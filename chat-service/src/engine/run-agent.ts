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
  group: string
  system?: string
  messages: UIMessage[]
  /** Prepended before the converted UI history, e.g. summary + memory blocks. */
  contextMessages?: ModelMessage[]
  tools?: ToolSet
  maxSteps?: number
  abortSignal?: AbortSignal
}

export async function runAgent(input: AgentRunInput) {
  // Bun's inbound Request signal can corrupt the body of a nested outbound
  // fetch when reused directly. A linked signal preserves cancellation while
  // giving model and tool calls a regular standalone AbortSignal.
  const abortSignal = input.abortSignal
    ? AbortSignal.any([input.abortSignal])
    : undefined
  return streamText({
    model: userModel(input.userId, input.modelId, input.group),
    system: input.system,
    messages: [
      ...(input.contextMessages ?? []),
      ...(await convertToModelMessages(input.messages)),
    ],
    tools: input.tools,
    stopWhen: stepCountIs(input.maxSteps ?? 8),
    abortSignal,
    onToolExecutionEnd: (event) => {
      if (event.toolOutput.type !== 'tool-error') return
      const error = event.toolOutput.error
      const message =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      console.error(`tool ${event.toolOutput.toolName} failed: ${message}`, error)
    },
  })
}
