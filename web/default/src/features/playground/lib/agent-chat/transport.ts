import type { ChatStatus, FileUIPart, UIMessage } from 'ai'

import type { ReasoningLevel } from '../../../pricing/types'
import type { ServerConversation } from '../../api'
import type { ChatAttachment, Message, MessageVersion } from '../../types'
import { hasRenderableMessageParts } from '../message/message-content-utils'

type AgentRevision = {
  revision: number
  content: string
  content_json?: string
  model?: string
  tool_json?: string
  status?: string
  created_at?: number
}

export type AgentMessageMetadata = {
  createdAt?: number
  model?: string
  status?: string
  hasNativeParts?: boolean
  activeRevision?: number
  revisions?: AgentRevision[]
  toolJson?: string
}

export type AgentUIMessage = UIMessage<AgentMessageMetadata>

export type AgentChatToolMode =
  | 'auto'
  | 'image'
  | 'video'
  | 'search'
  | 'document'

export type AgentChatRequestBodyInput = {
  conversationId?: number
  model: string
  group: string
  system: string
  carryHistory: boolean
  longMemory: boolean
  maxSteps: number
  toolMode: AgentChatToolMode
  reasoning?: ReasoningLevel
  expectedRevision?: number
  trigger: 'submit-message' | 'regenerate-message'
  messageId?: string
  requestKey: string
  message?: AgentUIMessage
}

type AgentServerMessage = {
  id: number
  role: string
  content: string
  content_json?: string
  model?: string
  tool_json?: string
  client_key?: string
  status?: string
  active_revision?: number
  revisions?: AgentRevision[]
  created_at?: number
}

type AgentConversationPayload = {
  conversation: ServerConversation & {
    revision?: number
    active_run_id?: string
  }
  messages: AgentServerMessage[]
}

type ApiEnvelope<T> = {
  success: boolean
  message?: string
  data?: T
}

type ToolPayload = {
  managedTool?: Message['managedTool']
  managedTools?: Message['managedTools']
  sources?: Message['sources']
  reasoning?: Message['reasoning']
  isReasoningStreaming?: boolean
}

function parseParts(
  raw: string | undefined,
  content: string
): { parts: AgentUIMessage['parts']; hasNativeParts: boolean } {
  if (raw) {
    try {
      const value = JSON.parse(raw) as unknown
      if (Array.isArray(value)) {
        const parts = value as AgentUIMessage['parts']
        if (content && !hasRenderableMessageParts(parts)) {
          throw new Error('persisted message parts are not renderable')
        }
        return {
          parts,
          hasNativeParts: true,
        }
      }
    } catch {
      // Fall through to the legacy text mirror.
    }
  }
  return {
    parts: content ? [{ type: 'text', text: content }] : [],
    hasNativeParts: false,
  }
}

function parseToolJson(raw?: string): ToolPayload {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as ToolPayload
  } catch {
    return {}
  }
}

function serverMessageToUIMessage(message: AgentServerMessage): AgentUIMessage {
  const role =
    message.role === 'assistant' || message.role === 'system'
      ? message.role
      : 'user'
  const parsedContent = parseParts(message.content_json, message.content)
  return {
    id: message.client_key || `srv-${message.id}`,
    role,
    parts: parsedContent.parts,
    metadata: {
      createdAt: message.created_at,
      model: message.model,
      status: message.status,
      hasNativeParts: parsedContent.hasNativeParts,
      activeRevision: message.active_revision,
      revisions: message.revisions,
      toolJson: message.tool_json,
    },
  }
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  let envelope: ApiEnvelope<T> | undefined
  try {
    envelope = (await response.json()) as ApiEnvelope<T>
  } catch {
    // The status fallback below remains actionable.
  }
  if (!response.ok || !envelope?.success) {
    throw new Error(envelope?.message || `Request failed (${response.status})`)
  }
  return envelope.data as T
}

function agentConversationUrl(conversationId: number): string {
  return `/chat-api/api/playground/conversations/${conversationId}`
}

export function agentChatRequestBody(input: AgentChatRequestBodyInput) {
  return {
    conversationId: input.conversationId,
    model: input.model,
    group: input.group,
    system: input.system,
    carryHistory: input.carryHistory,
    longMemory: input.longMemory,
    maxSteps: input.maxSteps,
    toolMode: input.toolMode,
    reasoning: input.reasoning,
    expectedRevision: input.expectedRevision,
    source: 'web' as const,
    trigger: input.trigger,
    messageId: input.messageId,
    requestKey: input.requestKey,
    message: input.message,
  }
}

export function shouldPollAgentRun(
  chatStatus: ChatStatus,
  activeRunId: string
): boolean {
  return (
    activeRunId !== '' &&
    chatStatus !== 'submitted' &&
    chatStatus !== 'streaming'
  )
}

export async function loadAgentConversation(conversationId: number): Promise<{
  messages: AgentUIMessage[]
  revision: number
  activeRunId: string
}> {
  const data = await apiRequest<AgentConversationPayload>(
    agentConversationUrl(conversationId)
  )
  return {
    messages: data.messages.map(serverMessageToUIMessage),
    revision: Number(data.conversation.revision ?? 0),
    activeRunId: data.conversation.active_run_id ?? '',
  }
}

export async function editAgentMessage(
  conversationId: number,
  message: Message,
  content: string,
  attachments: ChatAttachment[] | undefined,
  expectedRevision: number
): Promise<number> {
  const parts = [
    ...(message.from === 'user' ? attachmentFileParts(attachments) : []),
    { type: 'text' as const, text: content },
  ]
  const data = await apiRequest<{ revision: number }>(
    `${agentConversationUrl(conversationId)}/messages/${encodeURIComponent(message.key)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        content,
        parts,
        status: message.status,
        expected_revision: expectedRevision,
      }),
    }
  )
  return data.revision
}

export async function deleteAgentMessage(
  conversationId: number,
  messageId: string,
  expectedRevision: number
): Promise<number> {
  const data = await apiRequest<{ revision: number }>(
    `${agentConversationUrl(conversationId)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ expected_revision: expectedRevision }),
    }
  )
  return data.revision
}

export async function activateAgentMessageRevision(
  conversationId: number,
  messageId: string,
  revision: number,
  expectedRevision: number
): Promise<number> {
  const data = await apiRequest<{ revision: number }>(
    `${agentConversationUrl(conversationId)}/messages/${encodeURIComponent(messageId)}/revisions/${revision}/activate`,
    {
      method: 'POST',
      body: JSON.stringify({ expected_revision: expectedRevision }),
    }
  )
  return data.revision
}

export async function cancelAgentRun(
  conversationId: number,
  runId: string
): Promise<void> {
  await apiRequest<{ stopped: boolean }>(
    `${agentConversationUrl(conversationId)}/runs/${encodeURIComponent(runId)}/cancel`,
    { method: 'POST' }
  )
}

export function attachmentFileParts(
  attachments: ChatAttachment[] | undefined
): FileUIPart[] {
  return (attachments ?? []).map((attachment) => {
    if (!attachment.assetId) {
      throw new Error(`Attachment ${attachment.name} was not uploaded`)
    }
    return {
      type: 'file',
      mediaType: attachment.mimeType,
      filename: attachment.name,
      url: `/api/playground/assets/${attachment.assetId}/content`,
    }
  })
}

function filePartAttachment(
  part: FileUIPart,
  index: number
): ChatAttachment | null {
  const match = /^\/api\/playground\/assets\/(\d+)\/content$/.exec(part.url)
  if (!match) return null
  const assetId = Number(match[1])
  const base = {
    id: `asset-${assetId}-${index}`,
    name: part.filename || `attachment-${assetId}`,
    mimeType: part.mediaType,
    assetId,
  }
  return part.mediaType.startsWith('image/')
    ? { ...base, kind: 'image' }
    : { ...base, kind: 'document', text: '', status: 'done' }
}

function messageContent(message: AgentUIMessage): string {
  return message.parts
    .filter(
      (
        part
      ): part is Extract<AgentUIMessage['parts'][number], { type: 'text' }> =>
        part.type === 'text'
    )
    .map((part) => part.text)
    .join('\n')
}

export function agentUIMessageToPlayground(
  message: AgentUIMessage,
  pending: boolean
): Message {
  const content = messageContent(message)
  const persistedTool = parseToolJson(message.metadata?.toolJson)
  const revisions = message.metadata?.revisions ?? []
  const versions: MessageVersion[] = revisions.length
    ? revisions.map((revision) => ({
        id: String(revision.revision),
        content: revision.content,
      }))
    : [{ id: '1', content }]
  const activeRevision = message.metadata?.activeRevision ?? versions.length
  const attachments = message.parts
    .filter((part): part is FileUIPart => part.type === 'file')
    .map(filePartAttachment)
    .filter((attachment): attachment is ChatAttachment => attachment !== null)
  const createdAt = message.metadata?.createdAt
    ? message.metadata.createdAt * 1000
    : Date.now()
  let status: Message['status'] = 'complete'
  if (message.role === 'assistant' && pending) {
    status = message.parts.length > 0 ? 'streaming' : 'loading'
  } else if (message.metadata?.status === 'error') {
    status = 'error'
  } else if (message.metadata?.status === 'stopped') {
    status = 'stopped'
  }
  return {
    key: message.id,
    from: message.role,
    versions,
    parts:
      message.metadata?.hasNativeParts === false ? undefined : message.parts,
    activeVersion: Math.max(
      0,
      revisions.findIndex((revision) => revision.revision === activeRevision)
    ),
    attachments: attachments.length ? attachments : undefined,
    createdAt,
    model: message.metadata?.model,
    managedTool: persistedTool.managedTool,
    managedTools: persistedTool.managedTools,
    sources: persistedTool.sources,
    reasoning: persistedTool.reasoning,
    isReasoningStreaming: persistedTool.isReasoningStreaming,
    isReasoningComplete: Boolean(persistedTool.reasoning),
    status,
  }
}
