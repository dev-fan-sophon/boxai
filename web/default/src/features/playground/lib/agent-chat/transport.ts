import type { ChatStatus, FileUIPart, UIMessage } from 'ai'

import type { ServerConversation } from '../../api'
import type {
  ChatAttachment,
  ManagedDocumentArtifact,
  ManagedToolCard,
  Message,
  MessageSource,
  MessageVersion,
} from '../../types'

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
  managedTool?: ManagedToolCard
  sources?: MessageSource[]
  reasoning?: Message['reasoning']
}

function parseParts(
  raw: string | undefined,
  content: string
): AgentUIMessage['parts'] {
  if (raw) {
    try {
      const value = JSON.parse(raw) as unknown
      if (Array.isArray(value)) return value as AgentUIMessage['parts']
    } catch {
      // Fall through to the legacy text mirror.
    }
  }
  return content ? [{ type: 'text', text: content }] : []
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
  return {
    id: message.client_key || `srv-${message.id}`,
    role,
    parts: parseParts(message.content_json, message.content),
    metadata: {
      createdAt: message.created_at,
      model: message.model,
      status: message.status,
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

const agentConversationsUrl = '/chat-api/api/playground/conversations'

export async function listAgentConversations(params?: {
  p?: number
  page_size?: number
}): Promise<{ items: ServerConversation[]; total: number }> {
  const query = new URLSearchParams()
  if (params?.p) query.set('p', String(params.p))
  if (params?.page_size) query.set('page_size', String(params.page_size))
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return apiRequest<{ items: ServerConversation[]; total: number }>(
    `${agentConversationsUrl}${suffix}`
  )
}

export async function listAgentConversationsSince(
  since: number
): Promise<{ items: ServerConversation[]; has_more: boolean }> {
  return apiRequest<{ items: ServerConversation[]; has_more: boolean }>(
    `${agentConversationsUrl}?since=${encodeURIComponent(since)}`
  )
}

export async function updateAgentConversation(
  conversationId: number,
  input: {
    title?: string
    model?: string
    group?: string
    kind?: 'chat' | 'duo'
    meta_json?: string | Record<string, unknown>
    pinned?: boolean
  }
): Promise<ServerConversation> {
  return apiRequest<ServerConversation>(agentConversationUrl(conversationId), {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function deleteAgentConversation(
  conversationId: number
): Promise<void> {
  await apiRequest<null>(agentConversationUrl(conversationId), {
    method: 'DELETE',
  })
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

function documentArtifacts(
  output: Record<string, unknown>
): ManagedDocumentArtifact[] {
  const unverified = new Set(
    Array.isArray(output.unverified) ? (output.unverified as string[]) : []
  )
  if (!Array.isArray(output.documents)) return []
  return (
    output.documents as Array<{
      asset_id?: number
      name?: string
      url?: string
      mime?: string
      size?: number
    }>
  ).map((document) => ({
    assetId: document.asset_id ?? 0,
    name: document.name ?? '',
    url: document.url,
    mime: document.mime ?? '',
    size: document.size ?? 0,
    verified: !unverified.has(document.name ?? ''),
  }))
}

function liveToolPayload(parts: AgentUIMessage['parts']): ToolPayload {
  let managedTool: ManagedToolCard | undefined
  const sources: MessageSource[] = []
  const sourceHrefs = new Set<string>()
  let reasoning = ''
  for (const raw of parts) {
    const part = raw as unknown as Record<string, unknown>
    if (part.type === 'reasoning' && typeof part.text === 'string') {
      reasoning += `${reasoning ? '\n' : ''}${part.text}`
      continue
    }
    if (typeof part.type !== 'string' || !part.type.startsWith('tool-')) {
      continue
    }
    const action = part.type.slice(5) as ManagedToolCard['action']
    if (
      action !== 'web_search' &&
      action !== 'generate_image' &&
      action !== 'generate_video' &&
      action !== 'generate_document'
    ) {
      continue
    }
    const output =
      part.output && typeof part.output === 'object'
        ? (part.output as Record<string, unknown>)
        : {}
    if (part.state === 'output-error') {
      managedTool = {
        action,
        status: 'failed',
        error: typeof part.errorText === 'string' ? part.errorText : undefined,
      }
      continue
    }
    if (part.state !== 'output-available') {
      managedTool = { action, status: 'running', startedAt: Date.now() }
      continue
    }
    managedTool = { action, status: 'completed' }
    if (action === 'generate_image') {
      managedTool.model =
        typeof output.model === 'string' ? output.model : undefined
      managedTool.images = Array.isArray(output.images)
        ? (output.images as Array<{ url?: string }>)
            .map((image) => image.url || '')
            .filter(Boolean)
        : []
    } else if (action === 'generate_video') {
      managedTool.model =
        typeof output.model === 'string' ? output.model : undefined
      managedTool.taskId =
        typeof output.task_id === 'string' ? output.task_id : undefined
      managedTool.videoUrl =
        typeof output.video_url === 'string' ? output.video_url : undefined
    } else if (action === 'generate_document') {
      managedTool.documents = documentArtifacts(output)
      managedTool.documentAttempts =
        typeof output.attempts === 'number' ? output.attempts : undefined
    } else if (Array.isArray(output.sources)) {
      for (const source of output.sources as Array<{
        href?: string
        title?: string
        domain?: string
      }>) {
        if (!source.href || sourceHrefs.has(source.href)) continue
        sourceHrefs.add(source.href)
        sources.push({
          href: source.href,
          title: source.title || source.href,
          domain: source.domain,
        })
      }
    }
  }
  return {
    managedTool,
    sources: sources.length ? sources : undefined,
    reasoning: reasoning ? { content: reasoning, duration: 0 } : undefined,
  }
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
  const liveTool = liveToolPayload(message.parts)
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
    status = content ? 'streaming' : 'loading'
  } else if (message.metadata?.status === 'error') {
    status = 'error'
  } else if (message.metadata?.status === 'stopped') {
    status = 'stopped'
  }
  return {
    key: message.id,
    from: message.role,
    versions,
    activeVersion: Math.max(
      0,
      revisions.findIndex((revision) => revision.revision === activeRevision)
    ),
    attachments: attachments.length ? attachments : undefined,
    createdAt,
    model: message.metadata?.model,
    managedTool: liveTool.managedTool ?? persistedTool.managedTool,
    sources: liveTool.sources ?? persistedTool.sources,
    reasoning: liveTool.reasoning ?? persistedTool.reasoning,
    status,
  }
}
