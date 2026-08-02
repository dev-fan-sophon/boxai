import { stepCountIs, streamText } from 'ai'
import type {
  LanguageModelCallOptions,
  ModelMessage,
  ToolChoice,
  ToolSet,
} from 'ai'

import type { AgentToolName } from '../tools'
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
  /** Canonical server-owned history, including the user turn being answered. */
  messages: ModelMessage[]
  tools?: ToolSet
  forceTool?: AgentToolName
  maxSteps?: number
  reasoning?: LanguageModelCallOptions['reasoning']
  abortSignal?: AbortSignal
  onError?: (error: unknown) => void
}

export function agentToolChoice(
  forceTool: AgentToolName | undefined,
  stepNumber: number
): ToolChoice<ToolSet> | undefined {
  if (!forceTool) return undefined
  return stepNumber === 0 ? { type: 'tool', toolName: forceTool } : 'auto'
}

export async function runAgent(input: AgentRunInput) {
  return streamText({
    model: userModel(input.userId, input.modelId, input.group),
    system: input.system,
    messages: input.messages,
    reasoning: input.reasoning,
    tools: input.tools,
    // The gateway speaks OpenAI Chat Completions. Avoid a model fanning one
    // research turn out into several separately billed searches; each search
    // tool invocation already performs a multi-turn web search upstream.
    providerOptions: {
      boxaiGateway: {
        parallel_tool_calls: false,
        // The compatible provider intentionally treats standardized `none`
        // as omission. Use its native option to preserve an explicit disable.
        ...(input.reasoning === 'none' ? { reasoningEffort: 'none' } : {}),
      },
    },
    // Tools can legitimately take minutes, but a lost upstream request must
    // eventually terminate the AI SDK stream and release the durable run.
    timeout: {
      totalMs: 10 * 60_000,
      stepMs: 3 * 60_000,
      toolMs: 7 * 60_000,
    },
    stopWhen: stepCountIs(input.maxSteps ?? 8),
    prepareStep: input.forceTool
      ? ({ stepNumber }) => ({
          toolChoice: agentToolChoice(input.forceTool, stepNumber),
        })
      : undefined,
    abortSignal: input.abortSignal,
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
