import { config } from '../config'

/**
 * Typed client for the gateway's internal API. Every call carries the shared
 * secret; act-as calls additionally name the user they run for, and the
 * gateway executes them inside that user's ownership and billing context.
 */

export type GatewayUser = {
  id: number
  username: string
  role: number
  group: string
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

type GatewayEnvelope<T> = { success: boolean; message?: string; data?: T }

async function gatewayFetch<T>(
  path: string,
  init: RequestInit & { actAsUserId?: number } = {}
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('X-BoxAI-Internal-Secret', config.internalSecret)
  if (init.actAsUserId) {
    headers.set('X-BoxAI-Act-As-User', String(init.actAsUserId))
  }
  if (typeof init.body === 'string' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const response = await fetch(`${config.gatewayBaseUrl}${path}`, {
    ...init,
    headers,
  })
  if (!response.ok) {
    // Relay-style errors carry {error:{message}}, API errors {message}.
    let detail = ''
    try {
      const failure = (await response.json()) as {
        message?: string
        error?: { message?: string }
      }
      detail = failure.error?.message || failure.message || ''
    } catch {
      // Non-JSON failure body; the status alone has to do.
    }
    throw new GatewayError(
      detail || `gateway ${path} responded ${response.status}`,
      response.status
    )
  }
  const body = (await response.json()) as GatewayEnvelope<T>
  if (!body.success) {
    throw new GatewayError(body.message || `gateway ${path} failed`)
  }
  return body.data as T
}

/** Resolves a browser session cookie (forwarded verbatim) into the user. */
export async function resolveSession(
  cookieHeader: string
): Promise<GatewayUser> {
  return gatewayFetch<GatewayUser>('/api/internal/session', {
    headers: { Cookie: cookieHeader },
  })
}

export type DocumentPromptResponse = {
  system_prompt: string
  formats: string[]
  inputs: string[]
  previous: string[]
  previous_keys: string[]
  previous_names: string[]
  last_code: string
  max_attempts: number
}

export async function prepareDocumentBuild(
  userId: number,
  body: {
    request_text: string
    group: string
    conversation_id?: number
    asset_ids?: number[]
  },
  signal?: AbortSignal
): Promise<DocumentPromptResponse> {
  return gatewayFetch<DocumentPromptResponse>(
    '/api/internal/playground/documents/prompt',
    {
      method: 'POST',
      actAsUserId: userId,
      body: JSON.stringify(body),
      signal,
    }
  )
}

export type DocumentBuildAsset = {
  id: number
  kind: string
  name: string
  mime: string
  size: number
  url: string
}

export type DocumentBuildResponse = {
  status: 'completed' | 'failed'
  build_id: number
  attempt: number
  assets?: DocumentBuildAsset[]
  logs?: string
  unverified?: string[]
  error?: string
  can_retry?: boolean
  retry_prompt?: string
}

export async function buildDocument(
  userId: number,
  body: {
    external_run_id: string
    group: string
    conversation_id?: number
    asset_ids?: number[]
    formats: string[]
    previous_keys: string[]
    previous_names: string[]
    code: string
    chat_model: string
  },
  signal?: AbortSignal
): Promise<DocumentBuildResponse> {
  return gatewayFetch<DocumentBuildResponse>(
    '/api/internal/playground/documents/build',
    {
      method: 'POST',
      actAsUserId: userId,
      body: JSON.stringify(body),
      signal,
    }
  )
}

export async function releaseDocumentSandbox(
  userId: number,
  conversationId: number
): Promise<void> {
  await gatewayFetch('/api/internal/playground/documents/sandbox/release', {
    method: 'POST',
    actAsUserId: userId,
    body: JSON.stringify({ conversation_id: conversationId }),
  })
}

export type SearchSource = { href: string; title: string; domain: string }

export type SearchResult = {
  text: string
  sources: SearchSource[]
  model: string
}

/** Direct billed web search through the gateway's pinned Grok channel. */
export async function webSearch(
  userId: number,
  body: { query: string; group?: string },
  signal?: AbortSignal
): Promise<SearchResult> {
  return gatewayFetch<SearchResult>('/pg/internal/search', {
    method: 'POST',
    actAsUserId: userId,
    body: JSON.stringify(body),
    signal,
  })
}

export type ToolModels = {
  image_model: string
  video_model: string
  search_model: string
  search_group: string
  document: boolean
}

export async function toolModels(
  userId: number,
  group?: string,
  signal?: AbortSignal
): Promise<ToolModels> {
  const query = group ? `?group=${encodeURIComponent(group)}` : ''
  return gatewayFetch<ToolModels>(
    `/api/internal/playground/tool-models${query}`,
    {
      actAsUserId: userId,
      signal,
    }
  )
}

export type TaskStatus = {
  task_id: string
  status: string
  progress: string
  fail_reason?: string
  video_url?: string
}

export async function taskStatus(
  userId: number,
  taskId: string,
  signal?: AbortSignal
): Promise<TaskStatus> {
  return gatewayFetch<TaskStatus>(
    `/api/internal/playground/tasks/${encodeURIComponent(taskId)}`,
    {
      actAsUserId: userId,
      signal,
    }
  )
}

export type ImportedAsset = {
  id: number
  kind: string
  name: string
  mime: string
  size: number
  url: string
}

export async function importAsset(
  userId: number,
  body: { source_url: string; kind: 'image' | 'video' | 'audio' },
  signal?: AbortSignal
): Promise<ImportedAsset> {
  return gatewayFetch<ImportedAsset>('/api/internal/playground/assets/import', {
    method: 'POST',
    actAsUserId: userId,
    body: JSON.stringify(body),
    signal,
  })
}

export async function uploadAsset(
  userId: number,
  file: Blob,
  filename: string,
  signal?: AbortSignal
): Promise<ImportedAsset> {
  const form = new FormData()
  form.set('file', file, filename)
  return gatewayFetch<ImportedAsset>('/api/internal/playground/assets/upload', {
    method: 'POST',
    actAsUserId: userId,
    body: form,
    signal,
  })
}

/**
 * Relay fetch for billed model calls. The AI SDK provider uses this as its
 * custom fetch so every upstream call goes through the gateway's /pg relay
 * and bills the acted-as user.
 */
export function billedRelayFetch(
  userId: number,
  group?: string
): typeof globalThis.fetch {
  const billed = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.set('X-BoxAI-Internal-Secret', config.internalSecret)
    headers.set('X-BoxAI-Act-As-User', String(userId))
    let body = init?.body
    if (
      group &&
      typeof body === 'string' &&
      headers.get('content-type')?.includes('application/json')
    ) {
      const payload = JSON.parse(body) as Record<string, unknown>
      body = JSON.stringify({ ...payload, group })
    }
    return fetch(input, { ...init, body, headers })
  }
  // Bun's fetch type carries preconnect; delegate to keep the type honest.
  return Object.assign(billed, { preconnect: fetch.preconnect })
}
