import type { UIMessageChunk } from 'ai'

import { API_ENDPOINTS, ERROR_MESSAGES } from '../../constants'
import type {
  ManagedDocumentArtifact,
  ManagedToolCard,
  MessageSource,
} from '../../types'

type ManagedToolAction = ManagedToolCard['action']

/**
 * Stage labels reused from the legacy managed-tool cards so the agent path
 * adds no new translation keys.
 */
const TOOL_STAGE_KEYS: Record<ManagedToolAction, string> = {
  web_search: 'Searching the web',
  generate_image: 'Generating images',
  generate_video: 'Submitting the video task',
  generate_document: 'Preparing the sandbox',
}

const SSE_DONE = '[DONE]'

export type AgentChatRequest = {
  /** Absent on the first turn; the server creates the thread and returns its id. */
  conversationId?: number
  model: string
  group?: string
  system?: string
  longMemory?: boolean
  /** Client key of the new user turn; the server dedupes appends by it. */
  messageKey: string
  text: string
}

export type AgentChatCallbacks = {
  /** Server-side conversation id, read from the response header. */
  onConversationId: (conversationId: number) => void
  /** Id the server assigned to the assistant turn, when it sends one. */
  onAssistantId: (messageId: string) => void
  onTextDelta: (delta: string) => void
  onReasoningDelta: (delta: string) => void
  onReasoningEnd: () => void
  onToolCard: (card: ManagedToolCard) => void
  onSources: (sources: MessageSource[]) => void
  onError: (message: string) => void
}

export type AgentChatOptions = {
  request: AgentChatRequest
  callbacks: AgentChatCallbacks
  signal?: AbortSignal
}

type WebSearchOutput = {
  sources?: Array<{ href?: string; title?: string; domain?: string }>
}

type ImageOutput = {
  model?: string
  images?: Array<{ url?: string }>
}

type VideoOutput = {
  model?: string
  task_id?: string
  video_url?: string
}

type DocumentOutput = {
  documents?: Array<{
    asset_id?: number
    name?: string
    url?: string
    mime?: string
    size?: number
  }>
  attempts?: number
  unverified?: string[]
}

function toolAction(toolName: string): ManagedToolAction | undefined {
  if (
    toolName === 'web_search' ||
    toolName === 'generate_image' ||
    toolName === 'generate_video' ||
    toolName === 'generate_document'
  ) {
    return toolName
  }
  return undefined
}

/** The search query doubles as the card's free-text stage detail. */
function searchQuery(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const query = (input as { query?: unknown }).query
  return typeof query === 'string' && query ? query : undefined
}

function documentArtifacts(output: DocumentOutput): ManagedDocumentArtifact[] {
  const unverified = new Set(output.unverified ?? [])
  return (output.documents ?? []).map((document) => ({
    assetId: document.asset_id ?? 0,
    name: document.name ?? '',
    url: document.url,
    mime: document.mime ?? '',
    size: document.size ?? 0,
    verified: !unverified.has(document.name ?? ''),
  }))
}

function completedCard(
  action: ManagedToolAction,
  running: ManagedToolCard | undefined,
  output: unknown
): ManagedToolCard {
  const card: ManagedToolCard = {
    ...running,
    action,
    status: 'completed',
    stage: undefined,
  }
  if (action === 'generate_image') {
    const result = (output ?? {}) as ImageOutput
    card.model = result.model
    card.images = (result.images ?? [])
      .map((image) => image.url ?? '')
      .filter(Boolean)
    return card
  }
  if (action === 'generate_video') {
    const result = (output ?? {}) as VideoOutput
    card.model = result.model
    card.taskId = result.task_id
    card.videoUrl = result.video_url
    return card
  }
  if (action === 'generate_document') {
    const result = (output ?? {}) as DocumentOutput
    card.documents = documentArtifacts(result)
    card.documentAttempts = result.attempts
    return card
  }
  return card
}

function webSearchSources(output: unknown): MessageSource[] {
  const result = (output ?? {}) as WebSearchOutput
  return (result.sources ?? [])
    .filter((source) => Boolean(source.href))
    .map((source) => ({
      href: source.href as string,
      title: source.title || (source.href as string),
      domain: source.domain,
    }))
}

/** SSE frames carry one JSON chunk across one or more `data:` lines. */
function frameData(frame: string): string {
  return frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n')
}

async function responseErrorMessage(response: Response): Promise<string> {
  const fallback = `${ERROR_MESSAGES.API_REQUEST_ERROR} (${response.status})`
  let body = ''
  try {
    body = await response.text()
  } catch {
    return fallback
  }
  if (!body) return fallback
  try {
    const parsed = JSON.parse(body) as {
      message?: string
      error?: { message?: string }
    }
    return parsed.error?.message || parsed.message || fallback
  } catch {
    return body.slice(0, 500)
  }
}

/**
 * Streams one agent turn from the chat microservice and translates the AI SDK
 * UI message stream into playground message state. History, memories, and
 * persistence live on the server; the client only sends the new user turn.
 */
export async function sendAgentChat(options: AgentChatOptions): Promise<void> {
  const request = options.request
  const callbacks = options.callbacks
  // tool-output chunks only carry the call id, so the name is remembered from
  // the matching tool-input chunk.
  const actionsByCall = new Map<string, ManagedToolAction>()
  const cardsByCall = new Map<string, ManagedToolCard>()
  const sources: MessageSource[] = []

  const setCard = (toolCallId: string, card: ManagedToolCard) => {
    cardsByCall.set(toolCallId, card)
    callbacks.onToolCard(card)
  }

  const startToolCard = (
    toolCallId: string,
    toolName: string,
    stageDetail?: string
  ) => {
    const action = toolAction(toolName)
    if (!action) return
    actionsByCall.set(toolCallId, action)
    const running = cardsByCall.get(toolCallId)
    setCard(toolCallId, {
      action,
      status: 'running',
      startedAt: running?.startedAt ?? Date.now(),
      stage: TOOL_STAGE_KEYS[action],
      stageDetail: stageDetail ?? running?.stageDetail,
    })
  }

  const handleChunk = (chunk: UIMessageChunk) => {
    switch (chunk.type) {
      case 'start':
        if (chunk.messageId) callbacks.onAssistantId(chunk.messageId)
        return
      case 'text-delta':
        callbacks.onTextDelta(chunk.delta)
        return
      case 'reasoning-delta':
        callbacks.onReasoningDelta(chunk.delta)
        return
      case 'reasoning-end':
        callbacks.onReasoningEnd()
        return
      case 'tool-input-start':
        startToolCard(chunk.toolCallId, chunk.toolName)
        return
      case 'tool-input-available':
        startToolCard(
          chunk.toolCallId,
          chunk.toolName,
          searchQuery(chunk.input)
        )
        return
      case 'tool-output-available': {
        const action = actionsByCall.get(chunk.toolCallId)
        if (!action) return
        setCard(
          chunk.toolCallId,
          completedCard(action, cardsByCall.get(chunk.toolCallId), chunk.output)
        )
        if (action !== 'web_search') return
        const found = webSearchSources(chunk.output)
        if (found.length === 0) return
        sources.push(...found)
        callbacks.onSources([...sources])
        return
      }
      case 'tool-output-error': {
        const action = actionsByCall.get(chunk.toolCallId)
        if (!action) return
        setCard(chunk.toolCallId, {
          ...cardsByCall.get(chunk.toolCallId),
          action,
          status: 'failed',
          stage: undefined,
          error: chunk.errorText,
        })
        return
      }
      case 'error':
        callbacks.onError(chunk.errorText || ERROR_MESSAGES.API_REQUEST_ERROR)
        return
      default:
        return
    }
  }

  let response: Response
  try {
    response = await fetch(API_ENDPOINTS.AGENT_CHAT, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      signal: options.signal,
      body: JSON.stringify({
        conversationId: request.conversationId,
        model: request.model,
        group: request.group,
        system: request.system,
        longMemory: request.longMemory,
        source: 'web',
        message: {
          id: request.messageKey,
          role: 'user',
          parts: [{ type: 'text', text: request.text }],
        },
      }),
    })
  } catch {
    if (options.signal?.aborted) return
    callbacks.onError(ERROR_MESSAGES.NETWORK_ERROR)
    return
  }

  const conversationId = Number(response.headers.get('X-Conversation-Id'))
  if (Number.isFinite(conversationId) && conversationId > 0) {
    callbacks.onConversationId(conversationId)
  }

  if (!response.ok || !response.body) {
    callbacks.onError(await responseErrorMessage(response))
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let receivedDone = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const data = frameData(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (data === SSE_DONE) {
          receivedDone = true
          break
        }
        if (data) {
          try {
            handleChunk(JSON.parse(data) as UIMessageChunk)
          } catch {
            // A malformed frame must not kill the rest of the turn.
          }
        }
        boundary = buffer.indexOf('\n\n')
      }
      if (receivedDone) return
    }
  } catch {
    if (options.signal?.aborted) return
    callbacks.onError(ERROR_MESSAGES.CONNECTION_CLOSED)
    return
  }
  if (!options.signal?.aborted && !receivedDone) {
    callbacks.onError(ERROR_MESSAGES.CONNECTION_CLOSED)
  }
}
