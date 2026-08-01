import { and, asc, eq, gte, gt, inArray, sql } from 'drizzle-orm'

import { db } from './index'
import {
  agentRuns,
  conversations,
  messageRevisions,
  messages,
  userMemories,
} from './schema'

export const AGENT_RUN_LEASE_SECONDS = 60 * 60

type ConversationRow = typeof conversations.$inferSelect
type MessageRow = typeof messages.$inferSelect
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export class AgentConflictError extends Error {}

export type AgentMessageContent = {
  content: string
  contentJson?: string
  model?: string
  toolJson?: string
  status?: string
}

export type StartAgentRunInput = {
  conversationId: number
  userId: number
  trigger: 'submit-message' | 'regenerate-message'
  targetMessageKey?: string
  incoming?: AgentMessageContent & { clientKey: string; source?: string }
  requestKey: string
  model: string
}

export type StartedAgentRun = {
  runId: string
  conversation: ConversationRow
  userMessage: MessageRow
  assistantMessage?: MessageRow
  operation: 'append' | 'edit' | 'regenerate' | 'retry'
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

async function revisionCount(
  tx: Transaction,
  messageId: number
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`COUNT(*)` })
    .from(messageRevisions)
    .where(eq(messageRevisions.messageId, messageId))
  return Number(row?.count ?? 0)
}

async function seedRevision(tx: Transaction, row: MessageRow): Promise<number> {
  const count = await revisionCount(tx, row.id)
  if (count > 0) {
    return row.activeRevision && row.activeRevision > 0
      ? row.activeRevision
      : count
  }
  const revision =
    row.activeRevision && row.activeRevision > 0 ? row.activeRevision : 1
  await tx.insert(messageRevisions).values({
    messageId: row.id,
    conversationId: row.conversationId,
    userId: row.userId,
    revision,
    content: row.content ?? '',
    contentJson: row.contentJson ?? '',
    model: row.model ?? '',
    toolJson: row.toolJson ?? '',
    status: row.status || 'complete',
    createdAt: row.updatedAt || row.createdAt || nowSeconds(),
  })
  if (!row.activeRevision) {
    await tx
      .update(messages)
      .set({ activeRevision: revision })
      .where(eq(messages.id, row.id))
  }
  return revision
}

async function addRevision(
  tx: Transaction,
  row: MessageRow,
  content: AgentMessageContent
): Promise<MessageRow> {
  await seedRevision(tx, row)
  const [latest] = await tx
    .select({ max: sql<number>`MAX(${messageRevisions.revision})` })
    .from(messageRevisions)
    .where(eq(messageRevisions.messageId, row.id))
  const revision = Number(latest?.max ?? 0) + 1
  const now = nowSeconds()
  const contentJson = content.contentJson ?? row.contentJson ?? ''
  const model = content.model ?? row.model ?? ''
  const toolJson = content.toolJson ?? row.toolJson ?? ''
  const status = content.status ?? row.status ?? 'complete'
  await tx.insert(messageRevisions).values({
    messageId: row.id,
    conversationId: row.conversationId,
    userId: row.userId,
    revision,
    content: content.content,
    contentJson,
    model,
    toolJson,
    status,
    createdAt: now,
  })
  const [updated] = await tx
    .update(messages)
    .set({
      content: content.content,
      contentJson,
      model,
      toolJson,
      status,
      activeRevision: revision,
      updatedAt: now,
    })
    .where(eq(messages.id, row.id))
    .returning()
  if (!updated) throw new Error('message not found')
  return updated
}

async function invalidateDerivedState(
  tx: Transaction,
  conversationId: number,
  userId: number
): Promise<void> {
  await tx
    .delete(userMemories)
    .where(
      and(
        eq(userMemories.userId, userId),
        eq(userMemories.sourceConversationId, conversationId)
      )
    )
}

async function lockConversation(
  tx: Transaction,
  conversationId: number,
  userId: number,
  expectedRevision?: number
): Promise<ConversationRow> {
  const [conv] = await tx
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId)
      )
    )
    .for('update')
  if (!conv) throw new Error('conversation not found')
  const revision = Number(conv.revision ?? 0)
  if (expectedRevision !== undefined && expectedRevision !== revision) {
    throw new AgentConflictError('conversation changed; reload and try again')
  }

  const now = nowSeconds()
  if (
    conv.activeRunId &&
    (conv.activeRunStartedAt ?? 0) > now - AGENT_RUN_LEASE_SECONDS
  ) {
    throw new AgentConflictError('another response is still generating')
  }
  if (conv.activeRunId) {
    // Do not lock the expired run while holding the conversation lock:
    // completion takes those locks in the opposite order. Once a new run owns
    // activeRunId, any late completion marks the expired run superseded.
    conv.activeRunId = ''
    conv.activeRunStartedAt = 0
  }
  return conv
}

async function lockRunAndConversation(
  tx: Transaction,
  runId: string,
  userId: number,
  expectedConversationId?: number
): Promise<{
  run: typeof agentRuns.$inferSelect
  conversation: ConversationRow
} | null> {
  const [identity] = await tx
    .select({ conversationId: agentRuns.conversationId })
    .from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.userId, userId)))
  if (
    !identity ||
    (expectedConversationId !== undefined &&
      identity.conversationId !== expectedConversationId)
  ) {
    return null
  }
  const [conversation] = await tx
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, identity.conversationId),
        eq(conversations.userId, userId)
      )
    )
    .for('update')
  if (!conversation) return null
  const [run] = await tx
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.userId, userId)))
    .for('update')
  return run ? { run, conversation } : null
}

async function findMessageByKey(
  tx: Transaction,
  conversationId: number,
  userId: number,
  key: string
): Promise<MessageRow> {
  const [row] = await tx
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.userId, userId),
        eq(messages.clientKey, key)
      )
    )
  if (!row) throw new Error('message not found')
  return row
}

async function deleteMessageRows(
  tx: Transaction,
  conversationId: number,
  userId: number,
  seq: number,
  inclusive: boolean,
  keepMessageId?: number
): Promise<void> {
  const condition = inclusive ? gte(messages.seq, seq) : gt(messages.seq, seq)
  const rows = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.userId, userId),
        condition
      )
    )
  const ids = rows.map((row) => row.id).filter((id) => id !== keepMessageId)
  if (ids.length === 0) return
  await tx
    .delete(messageRevisions)
    .where(inArray(messageRevisions.messageId, ids))
  await tx.delete(messages).where(inArray(messages.id, ids))
}

async function pairedUserMessage(
  tx: Transaction,
  target: MessageRow
): Promise<{ user: MessageRow; assistant?: MessageRow }> {
  if (target.role === 'user') {
    const [linked] = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, target.conversationId),
          eq(messages.userId, target.userId),
          eq(messages.role, 'assistant'),
          eq(messages.parentMessageId, target.id)
        )
      )
      .orderBy(asc(messages.seq))
      .limit(1)
    if (linked) return { user: target, assistant: linked }

    const [legacy] = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, target.conversationId),
          eq(messages.userId, target.userId),
          eq(messages.role, 'assistant'),
          gt(messages.seq, target.seq)
        )
      )
      .orderBy(asc(messages.seq))
      .limit(1)
    if (legacy) {
      const [linkedLegacy] = await tx
        .update(messages)
        .set({ parentMessageId: target.id })
        .where(eq(messages.id, legacy.id))
        .returning()
      return { user: target, assistant: linkedLegacy ?? legacy }
    }
    return { user: target }
  }

  if (target.role !== 'assistant')
    throw new Error('message cannot be regenerated')
  if (target.parentMessageId) {
    const [user] = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.id, target.parentMessageId),
          eq(messages.userId, target.userId),
          eq(messages.role, 'user')
        )
      )
    if (user) return { user, assistant: target }
  }

  const [user] = await tx
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, target.conversationId),
        eq(messages.userId, target.userId),
        eq(messages.role, 'user'),
        sql`${messages.seq} < ${target.seq}`
      )
    )
    .orderBy(sql`${messages.seq} DESC`)
    .limit(1)
  if (!user) throw new Error('preceding user message not found')
  await tx
    .update(messages)
    .set({ parentMessageId: user.id })
    .where(eq(messages.id, target.id))
  return { user, assistant: { ...target, parentMessageId: user.id } }
}

export async function startAgentRun(
  input: StartAgentRunInput
): Promise<StartedAgentRun> {
  return db.transaction(async (tx) => {
    const conv = await lockConversation(tx, input.conversationId, input.userId)
    const [duplicate] = await tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.userId, input.userId),
          eq(agentRuns.requestKey, input.requestKey)
        )
      )
    if (duplicate) throw new AgentConflictError('request already submitted')

    const now = nowSeconds()
    let userMessage: MessageRow | undefined
    let assistantMessage: MessageRow | undefined
    let operation: StartedAgentRun['operation']

    if (input.trigger === 'submit-message' && input.incoming) {
      if (input.targetMessageKey) {
        const target = await findMessageByKey(
          tx,
          input.conversationId,
          input.userId,
          input.targetMessageKey
        )
        if (target.role !== 'user') {
          throw new Error('only user messages can be edited and resubmitted')
        }
        userMessage = await addRevision(tx, target, {
          content: input.incoming.content,
          contentJson: input.incoming.contentJson,
          model: input.model,
          status: 'complete',
        })
        await deleteMessageRows(
          tx,
          input.conversationId,
          input.userId,
          target.seq,
          false
        )
        await invalidateDerivedState(tx, input.conversationId, input.userId)
        operation = 'edit'
      } else {
        const [existing] = await tx
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, input.conversationId),
              eq(messages.clientKey, input.incoming.clientKey)
            )
          )
        if (existing) throw new AgentConflictError('message already submitted')
        const [seqRow] = await tx
          .select({ max: sql<number>`COALESCE(MAX(${messages.seq}), -1)` })
          .from(messages)
          .where(eq(messages.conversationId, input.conversationId))
        ;[userMessage] = await tx
          .insert(messages)
          .values({
            conversationId: input.conversationId,
            userId: input.userId,
            role: 'user',
            content: input.incoming.content,
            contentJson: input.incoming.contentJson ?? '',
            model: input.model,
            clientKey: input.incoming.clientKey,
            source: input.incoming.source ?? 'web',
            status: 'complete',
            activeRevision: 1,
            seq: Number(seqRow?.max ?? -1) + 1,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
        if (!userMessage) throw new Error('could not save user message')
        await seedRevision(tx, userMessage)
        operation = 'append'
      }
    } else if (
      input.trigger === 'regenerate-message' &&
      input.targetMessageKey
    ) {
      const target = await findMessageByKey(
        tx,
        input.conversationId,
        input.userId,
        input.targetMessageKey
      )
      const pair = await pairedUserMessage(tx, target)
      userMessage = pair.user
      assistantMessage = pair.assistant
      const boundary = assistantMessage?.seq ?? userMessage.seq
      await deleteMessageRows(
        tx,
        input.conversationId,
        input.userId,
        boundary,
        false,
        assistantMessage?.id
      )
      await invalidateDerivedState(tx, input.conversationId, input.userId)
      operation = assistantMessage ? 'regenerate' : 'retry'
    } else {
      throw new Error('invalid agent operation')
    }

    if (!userMessage) throw new Error('user message not found')
    const runId = crypto.randomUUID()
    const nextRevision = Number(conv.revision ?? 0) + 1
    await tx.insert(agentRuns).values({
      id: runId,
      conversationId: input.conversationId,
      userId: input.userId,
      requestKey: input.requestKey,
      operation,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage?.id ?? 0,
      baseRevision: nextRevision,
      status: 'running',
      leaseExpiresAt: now + AGENT_RUN_LEASE_SECONDS,
      createdAt: now,
      updatedAt: now,
    })
    const resetDerived = operation !== 'append'
    const [updatedConversation] = await tx
      .update(conversations)
      .set({
        revision: nextRevision,
        activeRunId: runId,
        activeRunStartedAt: now,
        updatedAt: now,
        ...(resetDerived
          ? { summary: '', summaryTailKey: '', summarySeq: 0, memorySeq: 0 }
          : {}),
      })
      .where(eq(conversations.id, input.conversationId))
      .returning()
    if (!updatedConversation) throw new Error('conversation not found')
    return {
      runId,
      conversation: updatedConversation,
      userMessage,
      assistantMessage,
      operation,
    }
  })
}

export async function finishAgentRun(
  runId: string,
  userId: number,
  response: AgentMessageContent & { clientKey: string; source?: string }
): Promise<{ message: MessageRow; revision: number } | null> {
  return db.transaction(async (tx) => {
    const locked = await lockRunAndConversation(tx, runId, userId)
    if (!locked) return null
    const { run, conversation: conv } = locked
    if (!run || run.status !== 'running') return null
    const now = nowSeconds()
    if (
      !conv ||
      conv.activeRunId !== runId ||
      Number(conv.revision ?? 0) !== Number(run.baseRevision ?? 0) ||
      Number(run.leaseExpiresAt ?? 0) < now
    ) {
      await tx
        .update(agentRuns)
        .set({ status: 'superseded', updatedAt: now })
        .where(eq(agentRuns.id, runId))
      if (conv?.activeRunId === runId) {
        await tx
          .update(conversations)
          .set({ activeRunId: '', activeRunStartedAt: 0, updatedAt: now })
          .where(eq(conversations.id, conv.id))
      }
      return null
    }

    let assistant: MessageRow | undefined
    if (run.assistantMessageId) {
      ;[assistant] = await tx
        .select()
        .from(messages)
        .where(eq(messages.id, run.assistantMessageId))
      if (!assistant) throw new Error('assistant message not found')
      assistant = await addRevision(tx, assistant, response)
    } else {
      if (!run.userMessageId) throw new Error('user message not found')
      const [userMessage] = await tx
        .select()
        .from(messages)
        .where(eq(messages.id, run.userMessageId))
      if (!userMessage) throw new Error('user message not found')
      const [seqRow] = await tx
        .select({ max: sql<number>`COALESCE(MAX(${messages.seq}), -1)` })
        .from(messages)
        .where(eq(messages.conversationId, run.conversationId))
      ;[assistant] = await tx
        .insert(messages)
        .values({
          conversationId: run.conversationId,
          userId,
          parentMessageId: userMessage.id,
          role: 'assistant',
          content: response.content,
          contentJson: response.contentJson ?? '',
          model: response.model ?? '',
          toolJson: response.toolJson ?? '',
          clientKey: response.clientKey,
          source: response.source ?? 'web',
          status: response.status ?? 'complete',
          activeRevision: 1,
          seq: Number(seqRow?.max ?? -1) + 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      if (!assistant) throw new Error('could not save assistant message')
      await seedRevision(tx, assistant)
    }

    await tx
      .update(agentRuns)
      .set({
        assistantMessageId: assistant.id,
        status: response.status === 'stopped' ? 'stopped' : 'completed',
        updatedAt: now,
      })
      .where(eq(agentRuns.id, runId))
    const finalRevision = Number(conv.revision ?? 0) + 1
    await tx
      .update(conversations)
      .set({
        revision: finalRevision,
        activeRunId: '',
        activeRunStartedAt: 0,
        updatedAt: now,
      })
      .where(eq(conversations.id, conv.id))
    return { message: assistant, revision: finalRevision }
  })
}

export async function failAgentRun(
  runId: string,
  userId: number,
  message: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const locked = await lockRunAndConversation(tx, runId, userId)
    if (!locked) return
    const { run } = locked
    if (!run || run.status !== 'running') return
    const now = nowSeconds()
    await tx
      .update(agentRuns)
      .set({
        status: 'failed',
        errorMessage: message.slice(0, 4000),
        updatedAt: now,
      })
      .where(eq(agentRuns.id, runId))
    await tx
      .update(conversations)
      .set({ activeRunId: '', activeRunStartedAt: 0, updatedAt: now })
      .where(
        and(
          eq(conversations.id, run.conversationId),
          eq(conversations.activeRunId, runId)
        )
      )
  })
}

export async function stopAgentRun(
  runId: string,
  userId: number,
  conversationId: number
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const locked = await lockRunAndConversation(
      tx,
      runId,
      userId,
      conversationId
    )
    if (!locked || locked.run.status !== 'running') return false
    const { run } = locked
    const now = nowSeconds()
    await tx
      .update(agentRuns)
      .set({ status: 'stopped', updatedAt: now })
      .where(eq(agentRuns.id, runId))
    await tx
      .update(conversations)
      .set({ activeRunId: '', activeRunStartedAt: 0, updatedAt: now })
      .where(
        and(
          eq(conversations.id, run.conversationId),
          eq(conversations.activeRunId, runId)
        )
      )
    return true
  })
}

export async function editAgentMessage(
  conversationId: number,
  userId: number,
  messageKey: string,
  content: AgentMessageContent,
  expectedRevision: number
): Promise<number> {
  return db.transaction(async (tx) => {
    const conv = await lockConversation(
      tx,
      conversationId,
      userId,
      expectedRevision
    )
    const target = await findMessageByKey(
      tx,
      conversationId,
      userId,
      messageKey
    )
    if (target.role !== 'assistant' && target.role !== 'user') {
      throw new Error('message cannot be edited')
    }
    await addRevision(tx, target, content)
    await invalidateDerivedState(tx, conversationId, userId)
    const revision = Number(conv.revision ?? 0) + 1
    await tx
      .update(conversations)
      .set({
        revision,
        activeRunId: conv.activeRunId ?? '',
        activeRunStartedAt: conv.activeRunStartedAt ?? 0,
        summary: '',
        summaryTailKey: '',
        summarySeq: 0,
        memorySeq: 0,
        updatedAt: nowSeconds(),
      })
      .where(eq(conversations.id, conversationId))
    return revision
  })
}

export async function deleteAgentMessage(
  conversationId: number,
  userId: number,
  messageKey: string,
  expectedRevision: number
): Promise<number> {
  return db.transaction(async (tx) => {
    const conv = await lockConversation(
      tx,
      conversationId,
      userId,
      expectedRevision
    )
    const target = await findMessageByKey(
      tx,
      conversationId,
      userId,
      messageKey
    )
    await tx
      .delete(messageRevisions)
      .where(eq(messageRevisions.messageId, target.id))
    await tx.delete(messages).where(eq(messages.id, target.id))
    await invalidateDerivedState(tx, conversationId, userId)
    const revision = Number(conv.revision ?? 0) + 1
    await tx
      .update(conversations)
      .set({
        revision,
        activeRunId: conv.activeRunId ?? '',
        activeRunStartedAt: conv.activeRunStartedAt ?? 0,
        summary: '',
        summaryTailKey: '',
        summarySeq: 0,
        memorySeq: 0,
        updatedAt: nowSeconds(),
      })
      .where(eq(conversations.id, conversationId))
    return revision
  })
}

export async function activateMessageRevision(
  conversationId: number,
  userId: number,
  messageKey: string,
  revisionNumber: number,
  expectedRevision: number
): Promise<number> {
  return db.transaction(async (tx) => {
    const conv = await lockConversation(
      tx,
      conversationId,
      userId,
      expectedRevision
    )
    const target = await findMessageByKey(
      tx,
      conversationId,
      userId,
      messageKey
    )
    await seedRevision(tx, target)
    const [revisionRow] = await tx
      .select()
      .from(messageRevisions)
      .where(
        and(
          eq(messageRevisions.messageId, target.id),
          eq(messageRevisions.revision, revisionNumber)
        )
      )
    if (!revisionRow) throw new Error('message revision not found')
    await tx
      .update(messages)
      .set({
        content: revisionRow.content ?? '',
        contentJson: revisionRow.contentJson ?? '',
        model: revisionRow.model ?? '',
        toolJson: revisionRow.toolJson ?? '',
        status: revisionRow.status ?? 'complete',
        activeRevision: revisionRow.revision,
        updatedAt: nowSeconds(),
      })
      .where(eq(messages.id, target.id))
    await invalidateDerivedState(tx, conversationId, userId)
    const revision = Number(conv.revision ?? 0) + 1
    await tx
      .update(conversations)
      .set({
        revision,
        activeRunId: conv.activeRunId ?? '',
        activeRunStartedAt: conv.activeRunStartedAt ?? 0,
        summary: '',
        summaryTailKey: '',
        summarySeq: 0,
        memorySeq: 0,
        updatedAt: nowSeconds(),
      })
      .where(eq(conversations.id, conversationId))
    return revision
  })
}
