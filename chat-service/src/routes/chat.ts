import {
  consumeStream,
  createUIMessageStreamResponse,
  isFileUIPart,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  readUIMessageStream,
} from 'ai'
import type { UIMessage } from 'ai'
import { Hono } from 'hono'

import { sessionAuth } from '../auth'
import type { AuthEnv } from '../auth'
import { assembleContext } from '../context/assemble'
import type { ContextAssemblyTiming } from '../context/assemble'
import { db } from '../db'
import {
  AgentConflictError,
  failAgentRun,
  finishAgentRun,
  startAgentRun,
  stopAgentRun,
} from '../db/agent-history'
import { conversations } from '../db/schema'
import { registerActiveRun } from '../engine/active-runs'
import { runAgent } from '../engine/run-agent'
import { truncateRunes, truncateUtf8 } from '../http'
import { runMemoryMaintenance } from '../memory/maintenance'
import {
  assetIdFromFilePart,
  AttachmentError,
  canonicalizeUserMessage,
  cleanupAttachmentAssets,
  storedMessageParts,
} from '../messages/content'
import { buildTools } from '../tools'
import { chatRequestSchema } from './chat-request'

type UIMessagePart = { type: string; text?: string }

function messageText(message: UIMessage): string {
  const parts = (message.parts ?? []) as UIMessagePart[]
  return parts
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text)
    .join('\n')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function persistedAssistantParts(parts: UIMessage['parts']): string {
  try {
    return JSON.stringify(parts, (key, value) =>
      key === 'providerMetadata' ? undefined : value
    )
  } catch {
    return ''
  }
}

function hasRenderableAssistantParts(parts: UIMessage['parts']): boolean {
  return parts.some((part) => {
    if (isTextUIPart(part) || isReasoningUIPart(part)) {
      return part.text.length > 0
    }
    return (
      isToolUIPart(part) ||
      isFileUIPart(part) ||
      part.type === 'reasoning-file' ||
      part.type === 'source-url' ||
      part.type === 'source-document'
    )
  })
}

export const chatRoute = new Hono<AuthEnv>()

chatRoute.post('/', sessionAuth, async (c) => {
  const requestStartedAt = performance.now()
  const parsed = chatRequestSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ success: false, message: 'invalid chat request' }, 400)
  }
  const user = c.get('user')
  const { model, group, system, trigger, messageId, requestKey, source } =
    parsed.data
  const carryHistory = parsed.data.carryHistory ?? true
  const longMemory = parsed.data.longMemory ?? false
  const maxSteps = parsed.data.maxSteps ?? 8
  const toolMode = parsed.data.toolMode ?? 'auto'
  const requestedGroup = group || user.group

  let canonicalizeMs = 0
  let incoming: Awaited<ReturnType<typeof canonicalizeUserMessage>> | undefined
  if (trigger === 'submit-message') {
    if (!parsed.data.message) {
      return c.json({ success: false, message: 'message is required' }, 400)
    }
    const canonicalizeStartedAt = performance.now()
    try {
      incoming = await canonicalizeUserMessage(
        user.id,
        parsed.data.message as UIMessage,
        requestedGroup,
        c.req.raw.signal
      )
    } catch (error) {
      const status = error instanceof AttachmentError ? 400 : 400
      return c.json({ success: false, message: errorMessage(error) }, status)
    }
    canonicalizeMs = performance.now() - canonicalizeStartedAt
  } else if (!messageId) {
    return c.json(
      { success: false, message: 'messageId is required for regeneration' },
      400
    )
  }

  const durableStartedAt = performance.now()
  let conversationId = parsed.data.conversationId
  if (!conversationId) {
    if (!incoming || messageId || trigger !== 'submit-message') {
      return c.json({ success: false, message: 'conversation not found' }, 404)
    }
    const now = Math.floor(Date.now() / 1000)
    const firstFile = incoming.uiMessage.parts.find(
      (part) => part.type === 'file'
    )
    const initialTitle =
      incoming.content.trim() || firstFile?.filename || 'New chat'
    const [created] = await db
      .insert(conversations)
      .values({
        userId: user.id,
        title: truncateRunes(initialTitle, 48),
        model,
        group: group ?? '',
        kind: 'chat',
        source: source ?? 'web',
        summary: '',
        summaryTailKey: '',
        summarySeq: 0,
        memorySeq: 0,
        revision: 0,
        activeRunId: '',
        activeRunStartedAt: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    if (!created) {
      return c.json(
        { success: false, message: 'could not create conversation' },
        500
      )
    }
    conversationId = created.id
  }
  c.header('X-Conversation-Id', String(conversationId))

  let started: Awaited<ReturnType<typeof startAgentRun>>
  try {
    started = await startAgentRun({
      conversationId,
      userId: user.id,
      expectedRevision: parsed.data.expectedRevision,
      trigger,
      targetMessageKey: messageId,
      incoming: incoming
        ? {
            content: incoming.content,
            contentJson: incoming.contentJson,
            clientKey: incoming.uiMessage.id,
            source: source ?? 'web',
          }
        : undefined,
      requestKey,
      model,
      group,
    })
  } catch (error) {
    const status = error instanceof AgentConflictError ? 409 : 400
    return c.json({ success: false, message: errorMessage(error) }, status)
  }
  const durableMs = performance.now() - durableStartedAt

  // Bind a newly created conversation even if attachment hydration or model
  // setup fails after the user turn has already been durably accepted.
  c.header('X-Agent-Run-Id', started.runId)

  const selectedGroup = group || started.conversation.group || user.group
  const generationController = new AbortController()
  const assistantClientKey =
    started.assistantMessage?.clientKey || crypto.randomUUID()
  let streamedMessage: UIMessage | undefined
  // The SSE consumer owns settlement after the browser disconnects. Only the
  // durable cancel endpoint aborts this controller; a reload must not discard
  // an otherwise valid response.
  const unregisterRun = registerActiveRun(
    started.runId,
    user.id,
    conversationId,
    generationController,
    () => {
      const parts = streamedMessage?.parts ?? []
      return {
        content: streamedMessage
          ? truncateUtf8(messageText(streamedMessage), 60_000)
          : '',
        contentJson: hasRenderableAssistantParts(parts)
          ? persistedAssistantParts(parts)
          : '',
        clientKey: streamedMessage?.id || assistantClientKey,
        model,
        source: source ?? 'web',
      }
    }
  )
  void cleanupAttachmentAssets(user.id, started.orphanedContentJson)
  let contextTiming: ContextAssemblyTiming = {
    memoryQueryMs: 0,
    historyQueryMs: 0,
    hydrationMs: 0,
  }
  const contextStartedAt = performance.now()
  let context
  try {
    context = await assembleContext(started.conversation, {
      longMemory,
      carryHistory,
      group: selectedGroup,
      signal: generationController.signal,
      excludeMessageId: started.assistantMessage?.id,
      focusMessageId: started.userMessage.id,
      preparedFocus: incoming,
      onTiming: (timing) => {
        contextTiming = timing
      },
    })
  } catch (error) {
    unregisterRun()
    await failAgentRun(started.runId, user.id, errorMessage(error))
    return c.json({ success: false, message: errorMessage(error) }, 400)
  }
  const contextMs = performance.now() - contextStartedAt

  const userParts = storedMessageParts(
    started.userMessage.content ?? '',
    started.userMessage.contentJson ?? ''
  )
  const assetIds = userParts
    .filter((part) => part.type === 'file')
    .map(assetIdFromFilePart)
    .filter((id): id is number => id !== null)
  const originalUserMessage: UIMessage = {
    id: started.userMessage.clientKey || `srv-${started.userMessage.id}`,
    role: 'user',
    parts: userParts,
  }

  let result
  const agentSetupStartedAt = performance.now()
  try {
    const toolPolicy = buildTools(
      {
        userId: user.id,
        group: selectedGroup,
        modelId: model,
        conversationId,
        assetIds,
      },
      toolMode
    )
    result = await runAgent({
      userId: user.id,
      modelId: model,
      group: selectedGroup,
      system,
      messages: context,
      tools: toolPolicy.tools,
      forceTool: toolPolicy.forceTool,
      maxSteps,
      reasoning: parsed.data.reasoning,
      abortSignal: generationController.signal,
      onError: (error) => {
        console.error(`agent generation failed (run ${started.runId}):`, error)
      },
    })
  } catch (error) {
    unregisterRun()
    await failAgentRun(started.runId, user.id, errorMessage(error))
    return c.json({ success: false, message: errorMessage(error) }, 400)
  }
  const agentSetupMs = performance.now() - agentSetupStartedAt

  const uiMessageStream = result.toUIMessageStream<UIMessage>({
    originalMessages: [originalUserMessage],
    generateMessageId: () => assistantClientKey,
    sendSources: true,
    onError: (error) =>
      truncateUtf8(errorMessage(error), 500) || 'generation failed',
    onEnd: async ({ responseMessage, isAborted }) => {
      try {
        const text = truncateUtf8(messageText(responseMessage), 60_000)
        const parts = responseMessage.parts ?? []
        const contentJson = persistedAssistantParts(parts)
        const hasRenderableParts = hasRenderableAssistantParts(parts)
        if (!text.trim() && !hasRenderableParts) {
          if (isAborted) {
            await stopAgentRun(started.runId, user.id, conversationId)
          } else {
            await failAgentRun(
              started.runId,
              user.id,
              'generation returned no content'
            )
          }
          return
        }
        const saved = await finishAgentRun(started.runId, user.id, {
          content: text,
          contentJson,
          model,
          toolJson: '',
          clientKey: responseMessage.id,
          source: source ?? 'web',
          status: isAborted ? 'stopped' : 'complete',
        })
        if (saved && !isAborted) {
          void runMemoryMaintenance(user.id, conversationId, longMemory)
        }
      } catch (error) {
        console.error(
          `failed to persist assistant turn (conversation ${conversationId}):`,
          error
        )
        await failAgentRun(started.runId, user.id, errorMessage(error)).catch(
          (cleanupError) => {
            console.error(
              `failed to clear agent run ${started.runId}:`,
              cleanupError
            )
          }
        )
      } finally {
        unregisterRun()
      }
    },
  })
  const [responseStream, snapshotStream] = uiMessageStream.tee()
  void (async () => {
    for await (const message of readUIMessageStream<UIMessage>({
      stream: snapshotStream,
    })) {
      streamedMessage = message
    }
  })().catch((error: unknown) => {
    console.error(`failed to snapshot agent run ${started.runId}:`, error)
  })
  const response = createUIMessageStreamResponse({
    stream: responseStream,
    consumeSseStream: ({ stream }) => consumeStream({ stream }),
  })
  response.headers.set('X-Conversation-Id', String(conversationId))
  response.headers.set(
    'X-Conversation-Revision',
    String(started.conversation.revision ?? 0)
  )
  response.headers.set('X-Agent-Run-Id', started.runId)
  response.headers.set('Cache-Control', 'no-cache, no-transform')
  response.headers.set('X-Accel-Buffering', 'no')
  const setupTiming = {
    auth: c.get('authDurationMs'),
    canonicalize: canonicalizeMs,
    durable: durableMs,
    context: contextMs,
    'memory-db': contextTiming.memoryQueryMs,
    'history-db': contextTiming.historyQueryMs,
    hydrate: contextTiming.hydrationMs,
    agent: agentSetupMs,
    setup: performance.now() - requestStartedAt + c.get('authDurationMs'),
  }
  response.headers.set(
    'Server-Timing',
    Object.entries(setupTiming)
      .map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`)
      .join(', ')
  )
  console.info(
    JSON.stringify({
      event: 'chat_setup_timing',
      run_id: started.runId,
      ...setupTiming,
    })
  )
  return response
})
