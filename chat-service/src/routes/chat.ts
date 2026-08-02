import { consumeStream } from 'ai'
import type { UIMessage } from 'ai'
import { Hono } from 'hono'
import { z } from 'zod'

import { sessionAuth } from '../auth'
import type { AuthEnv } from '../auth'
import { assembleContext } from '../context/assemble'
import { db } from '../db'
import {
  AgentConflictError,
  failAgentRun,
  finishAgentRun,
  startAgentRun,
  stopAgentRun,
} from '../db/agent-history'
import { conversations } from '../db/schema'
import { encodeLegacyToolJson } from '../db/tool-json'
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

const chatRequestSchema = z.object({
  conversationId: z.number().int().positive().optional(),
  model: z.string().min(1).max(191),
  group: z.string().max(50).optional(),
  system: z.string().max(20_000).optional(),
  carryHistory: z.boolean().optional(),
  longMemory: z.boolean().optional(),
  maxSteps: z.number().int().min(1).max(21).optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  toolMode: z
    .enum(['auto', 'image', 'video', 'search', 'document'])
    .optional(),
  source: z.enum(['web', 'desktop']).optional(),
  trigger: z
    .enum(['submit-message', 'regenerate-message'])
    .default('submit-message'),
  messageId: z.string().min(1).max(64).optional(),
  requestKey: z.string().uuid(),
  message: z.unknown().optional(),
})

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
    const json = JSON.stringify(parts, (key, value) =>
      key === 'providerMetadata' ? undefined : value
    )
    return Buffer.byteLength(json, 'utf8') <= 60_000 ? json : ''
  } catch {
    return ''
  }
}

export const chatRoute = new Hono<AuthEnv>()

chatRoute.post('/', sessionAuth, async (c) => {
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

  let incoming: Awaited<ReturnType<typeof canonicalizeUserMessage>> | undefined
  if (trigger === 'submit-message') {
    if (!parsed.data.message) {
      return c.json({ success: false, message: 'message is required' }, 400)
    }
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
  } else if (!messageId) {
    return c.json(
      { success: false, message: 'messageId is required for regeneration' },
      400
    )
  }

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

  // Bind a newly created conversation even if attachment hydration or model
  // setup fails after the user turn has already been durably accepted.
  c.header('X-Agent-Run-Id', started.runId)

  const selectedGroup = group || started.conversation.group || user.group
  const generationController = new AbortController()
  const assistantClientKey =
    started.assistantMessage?.clientKey || crypto.randomUUID()
  let streamedText = ''
  // The SSE consumer owns settlement after the browser disconnects. Only the
  // durable cancel endpoint aborts this controller; a reload must not discard
  // an otherwise valid response.
  const unregisterRun = registerActiveRun(
    started.runId,
    user.id,
    conversationId,
    generationController,
    () => ({
      content: streamedText,
      clientKey: assistantClientKey,
      model,
      source: source ?? 'web',
    })
  )
  void cleanupAttachmentAssets(user.id, started.orphanedContentJson)
  let context
  try {
    context = await assembleContext(started.conversation, {
      longMemory,
      carryHistory,
      group: selectedGroup,
      signal: generationController.signal,
      excludeMessageId: started.assistantMessage?.id,
      focusMessageId: started.userMessage.id,
    })
  } catch (error) {
    unregisterRun()
    await failAgentRun(started.runId, user.id, errorMessage(error))
    return c.json({ success: false, message: errorMessage(error) }, 400)
  }

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
      abortSignal: generationController.signal,
      onTextDelta: (text) => {
        streamedText = truncateUtf8(streamedText + text, 60_000)
      },
      onError: (error) => {
        console.error(`agent generation failed (run ${started.runId}):`, error)
      },
    })
  } catch (error) {
    unregisterRun()
    await failAgentRun(started.runId, user.id, errorMessage(error))
    return c.json({ success: false, message: errorMessage(error) }, 400)
  }

  const response = result.toUIMessageStreamResponse({
    originalMessages: [originalUserMessage],
    generateMessageId: () => assistantClientKey,
    consumeSseStream: ({ stream }) => consumeStream({ stream }),
    onError: (error) =>
      truncateUtf8(errorMessage(error), 500) || 'generation failed',
    onEnd: async ({ responseMessage, isAborted }) => {
      try {
        const text = truncateUtf8(messageText(responseMessage), 60_000)
        const parts = responseMessage.parts ?? []
        const toolJson = encodeLegacyToolJson(parts)
        if (!text.trim() && !toolJson) {
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
          contentJson: persistedAssistantParts(parts),
          model,
          toolJson,
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
  response.headers.set('X-Conversation-Id', String(conversationId))
  response.headers.set(
    'X-Conversation-Revision',
    String(started.conversation.revision ?? 0)
  )
  response.headers.set('X-Agent-Run-Id', started.runId)
  return response
})
