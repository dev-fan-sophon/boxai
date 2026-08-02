import { stepCountIs, streamText } from 'ai'
import type { ModelMessage, ToolChoice, ToolSet } from 'ai'

import { userModel } from './provider'
import type { AgentToolName } from '../tools'

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
  /** Canonical server-owned history, including the user turn being answered. */
  messages: ModelMessage[]
  tools?: ToolSet
  forceTool?: AgentToolName
  maxSteps?: number
  abortSignal?: AbortSignal
  onTextDelta?: (text: string) => void
  onError?: (error: unknown) => void
}

export function agentToolChoice(
  forceTool: AgentToolName | undefined,
  stepNumber: number
): ToolChoice<ToolSet> | undefined {
  if (!forceTool) return undefined
  return stepNumber === 0
    ? { type: 'tool', toolName: forceTool }
    : 'auto'
}

export async function runAgent(input: AgentRunInput) {
  return streamText({
    model: userModel(input.userId, input.modelId, input.group),
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    stopWhen: stepCountIs(input.maxSteps ?? 8),
    prepareStep: input.forceTool
      ? ({ stepNumber }) => ({
          toolChoice: agentToolChoice(input.forceTool, stepNumber),
        })
      : undefined,
    abortSignal: input.abortSignal,
    onChunk: ({ chunk }) => {
      if (chunk.type === 'text-delta') input.onTextDelta?.(chunk.text)
    },
    onError: ({ error }) => input.onError?.(error),
    onToolExecutionEnd: (event) => {
      if (event.toolOutput.type !== 'tool-error') return
      const error = event.toolOutput.error
      const message =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error)
      console.error(
        `tool ${event.toolOutput.toolName} failed: ${message}`,
        error
      )
    },
  })
}
