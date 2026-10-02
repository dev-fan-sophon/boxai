import { t } from 'i18next'

import { api } from '@/lib/api'

import { API_ENDPOINTS } from './constants'
import type { VideoCapabilities } from './hooks/use-video-capabilities'
import type {
  InspirationCollection,
  InspirationEventType,
  InspirationLibrary,
  InspirationRecipe,
} from './inspiration/types'
import { parseRequestErrorDetails } from './lib/streaming/request-error-utils'
import { buildImageGenerationRequestBody } from './lib/studio/image-request-schema'
import {
  resolveVideoOptions,
  videoSizeForOptions,
  type VideoAspectRatio,
  type VideoModelCapabilities,
  type VideoResolution,
} from './lib/studio/video-capabilities'
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelOption,
  GroupOption,
  GeneratedImage,
  StudioSettings,
  VideoSubmission,
} from './types'

/**
 * Send chat completion request (non-streaming)
 */
export async function sendChatCompletion(
  payload: ChatCompletionRequest,
  signal?: AbortSignal
): Promise<ChatCompletionResponse> {
  const res = await api.post(API_ENDPOINTS.CHAT_COMPLETIONS, payload, {
    signal,
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Get user available models
 */
export async function getUserModels(group: string): Promise<ModelOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_MODELS, {
    params: { group },
  })
  const { data } = res

  if (!data.success || !Array.isArray(data.data)) {
    return []
  }

  return data.data.map((model: string) => ({
    label: model,
    value: model,
  }))
}

/**
 * Get user groups
 */
export async function getUserGroups(): Promise<GroupOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_GROUPS)
  const { data } = res

  if (!data.success || !data.data) {
    return []
  }

  const groupData = data.data as Record<string, { desc: string; ratio: number }>

  return Object.entries(groupData).map(([group, info]) => ({
    label: group,
    value: group,
    ratio: info.ratio,
    desc: info.desc,
  }))
}

export async function getVideoCapabilities(
  group: string,
  model: string
): Promise<VideoCapabilities> {
  const response = await api.get('/api/playground/video-capabilities', {
    params: { group, model },
  })
  const data: unknown = response.data?.data
  if (!response.data?.success || !data || typeof data !== 'object') return {}
  const result: VideoCapabilities = {}
  for (const mode of ['text', 'frames', 'references'] as const) {
    const profile = (data as Record<string, unknown>)[mode]
    if (!profile || typeof profile !== 'object') continue
    const value = profile as Partial<VideoModelCapabilities>
    if (
      !Array.isArray(value.aspectRatios) ||
      !Array.isArray(value.resolutions) ||
      !Array.isArray(value.imageOnlyResolutions) ||
      !Array.isArray(value.durations) ||
      !value.durationRange ||
      !value.defaults ||
      typeof value.maxReferenceImages !== 'number'
    ) {
      continue
    }
    // Older servers omit the multimodal fields; absent means unsupported.
    result[mode] = {
      ...(value as VideoModelCapabilities),
      maxReferenceVideos: value.maxReferenceVideos ?? 0,
      maxReferenceAudios: value.maxReferenceAudios ?? 0,
      audioReferenceRequiresVisual: value.audioReferenceRequiresVisual ?? false,
      supportsSeed: value.supportsSeed ?? false,
      supportsWatermark: value.supportsWatermark ?? false,
      returnsLastFrame: value.returnsLastFrame ?? false,
    }
  }
  return result
}

/**
 * Resolve media for upstream providers.
 * Exchange private content paths for temporary provider-readable references.
 * All other references retain their original transport semantics.
 */
export async function resolveMediaForUpstream(
  ref: string | null | undefined
): Promise<string | null> {
  if (!ref) return null
  const value = ref.trim()
  if (!value) return null
  const asset = /^\/api\/playground\/assets\/(\d+)\/content$/.exec(value)
  if (asset) {
    const response = await api.post(
      `/api/playground/assets/${asset[1]}/reference`
    )
    if (!response.data.success || !response.data.data?.url) {
      throw new Error(response.data.message || t('Request failed'))
    }
    return response.data.data.url
  }
  return value
}

export type ImageGenerateInput = {
  model: string
  group: string
  prompt: string
  settings: StudioSettings
  /** data URL or asset content URL — private paths become signed references */
  referenceImage?: string | null
  /** extra references sent alongside the first one (multi-image edit) */
  referenceImages?: Array<string | null | undefined>
  /** when true with reference, use /pg/images/edits */
  editMode?: boolean
}

export async function generateImages(
  input: ImageGenerateInput
): Promise<GeneratedImage[]> {
  const ref = await resolveMediaForUpstream(input.referenceImage)
  const extraRefs = await Promise.all(
    (input.referenceImages ?? []).map((item) => resolveMediaForUpstream(item))
  )
  const body = buildImageGenerationRequestBody({
    model: input.model,
    group: input.group,
    prompt: input.prompt,
    settings: input.settings,
    referenceImage: ref,
    referenceImages: extraRefs,
  })
  const endpoint =
    input.editMode && ref
      ? API_ENDPOINTS.IMAGE_EDITS
      : API_ENDPOINTS.IMAGE_GENERATIONS
  try {
    const response = await api.post(endpoint, body, {
      skipErrorHandler: true,
    } as Record<string, unknown>)
    const items = (response.data?.data ?? []) as Array<{
      url?: string
      b64_json?: string
      revised_prompt?: string
    }>
    return items
      .map((item) => ({
        url:
          item.url ||
          (item.b64_json ? `data:image/png;base64,${item.b64_json}` : ''),
        revisedPrompt: item.revised_prompt,
      }))
      .filter((item) => item.url)
  } catch (error) {
    const details = parseRequestErrorDetails(error)
    throw new Error(details.errorMessage)
  }
}

export type VideoSubmitInput = {
  model: string
  group: string
  prompt: string
  settings: StudioSettings
  firstFrame?: string | null
  lastFrame?: string | null
  inputReference?: string | null
  referenceImages?: string[]
  /** Typed multimodal references (references mode only). */
  referenceVideos?: string[]
  referenceAudios?: string[]
  /** Fixed seed; omitted for a random seed. Volcengine metadata only. */
  seed?: number
  watermark?: boolean
  /**
   * Explicit output options. When present they override `settings.videoSize`
   * / `settings.videoDuration` and are also sent as Volcengine metadata for
   * models that consume it (Seedance family).
   */
  aspectRatio?: VideoAspectRatio
  resolution?: VideoResolution
  duration?: number
  generateAudio?: boolean
  capabilities?: VideoModelCapabilities
}

/**
 * Builds the uniform OpenAI-style video request understood by every BoxAI
 * video channel: `size`/`duration` for native adaptors, string `seconds` plus
 * `metadata.{resolution,ratio,generate_audio,seed,watermark,return_last_frame}`
 * for Seedance (xAI reads only `metadata.generate_audio`), and
 * `first_frame`/`last_frame` (frames) or `images` / `reference_images` plus
 * `reference_videos` / `reference_audios` (references), which the backend
 * maps to provider roles.
 */
export async function buildVideoRequestBody(
  input: VideoSubmitInput
): Promise<Record<string, unknown>> {
  const capabilities = input.capabilities
  if (!capabilities) throw new Error(t('Video capabilities are unavailable.'))
  const references = input.referenceImages ?? []
  const referenceVideos = input.referenceVideos ?? []
  const referenceAudios = input.referenceAudios ?? []
  if (references.length > capabilities.maxReferenceImages) {
    throw new Error(
      t('You can attach up to {{count}} images.', {
        count: capabilities.maxReferenceImages,
      })
    )
  }
  const maxVideos = capabilities.maxReferenceVideos ?? 0
  const maxAudios = capabilities.maxReferenceAudios ?? 0
  if (referenceVideos.length > maxVideos) {
    throw new Error(
      t('You can attach up to {{count}} reference videos.', {
        count: maxVideos,
      })
    )
  }
  if (referenceAudios.length > maxAudios) {
    throw new Error(
      t('You can attach up to {{count}} reference audios.', {
        count: maxAudios,
      })
    )
  }
  if (
    capabilities.audioReferenceRequiresVisual &&
    referenceAudios.length > 0 &&
    references.length + referenceVideos.length === 0
  ) {
    throw new Error(t('Add a reference image or video to use reference audio.'))
  }
  const duration = input.duration ?? input.settings.videoDuration
  const size =
    input.aspectRatio && input.resolution
      ? videoSizeForOptions(input.aspectRatio, input.resolution)
      : input.settings.videoSize
  const body: Record<string, unknown> = {
    model: input.model,
    group: input.group,
    prompt: input.prompt,
    duration,
    seconds: String(duration),
  }
  if (size) body.size = size
  const metadata: Record<string, unknown> = {}
  if (capabilities.supportsAudioToggle && input.generateAudio !== undefined) {
    metadata.generate_audio = input.generateAudio
  }
  if (capabilities.usesVolcengineMetadata) {
    if (input.resolution) metadata.resolution = input.resolution
    if (input.aspectRatio) metadata.ratio = input.aspectRatio
    if (capabilities.supportsSeed && input.seed !== undefined) {
      metadata.seed = input.seed
    }
    if (capabilities.supportsWatermark && input.watermark !== undefined) {
      metadata.watermark = input.watermark
    }
    // Free with the run; lets the studio continue from the final frame.
    if (capabilities.returnsLastFrame) metadata.return_last_frame = true
  }
  if (Object.keys(metadata).length) body.metadata = metadata

  const first = await resolveMediaForUpstream(
    input.firstFrame || input.inputReference
  )
  const last = await resolveMediaForUpstream(input.lastFrame)
  if (first) {
    body.first_frame = first
    body.input_reference = first
    body.image = first
    body.images = [first]
  }
  if (last) {
    body.last_frame = last
    const images = (body.images as string[] | undefined) ?? []
    if (!images.includes(last)) {
      body.images = [...images, last]
    }
  }
  const referenceMedia =
    references.length + referenceVideos.length + referenceAudios.length
  if (referenceMedia > 0 && (first || last)) {
    throw new Error(
      t('Reference images cannot be combined with first/last frames.')
    )
  }
  if (references.length > 0) {
    const resolved = await Promise.all(references.map(resolveMediaForUpstream))
    // xAI reads untyped `images` as the first frame; Seedance and other
    // channels read them as references.
    if (capabilities.family === 'xai') body.reference_images = resolved
    else body.images = resolved
  }
  if (referenceVideos.length > 0) {
    body.reference_videos = await Promise.all(
      referenceVideos.map(resolveMediaForUpstream)
    )
  }
  if (referenceAudios.length > 0) {
    body.reference_audios = await Promise.all(
      referenceAudios.map(resolveMediaForUpstream)
    )
  }
  return body
}

export async function submitVideo(
  input: VideoSubmitInput
): Promise<VideoSubmission> {
  // Policy can change while the composer is open. Recheck immediately before
  // uploading media or creating a billable task.
  const profiles = await getVideoCapabilities(input.group, input.model)
  let mode: 'text' | 'frames' | 'references' = 'text'
  const referenceCount =
    (input.referenceImages?.length ?? 0) +
    (input.referenceVideos?.length ?? 0) +
    (input.referenceAudios?.length ?? 0)
  if (referenceCount > 0) mode = 'references'
  else if (input.firstFrame || input.lastFrame || input.inputReference) {
    mode = 'frames'
  }
  const capabilities = profiles[mode]
  if (!capabilities) {
    throw new Error(t('This video mode is unavailable for the selected model.'))
  }
  const options = resolveVideoOptions(
    capabilities,
    {
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      seconds: input.duration,
      size: input.settings.videoSize,
      generateAudio: input.generateAudio,
      referenceMode: mode,
    },
    { hasImage: mode !== 'text', mode }
  )
  const policyChanged =
    options.aspectRatio !== input.aspectRatio ||
    options.resolution !== input.resolution ||
    options.duration !== input.duration ||
    (Boolean(input.lastFrame) && !capabilities.supportsLastFrame) ||
    (input.generateAudio !== undefined &&
      (capabilities.supportsAudioToggle
        ? options.generateAudio !== input.generateAudio
        : true))
  if (policyChanged) {
    throw new Error(
      t('Video options changed. Refresh the options and try again.')
    )
  }
  const body = await buildVideoRequestBody({
    ...input,
    capabilities,
    aspectRatio: options.aspectRatio,
    resolution: options.resolution,
    duration: options.duration,
    generateAudio: capabilities.supportsAudioToggle
      ? options.generateAudio
      : undefined,
  })
  try {
    const response = await api.post(API_ENDPOINTS.VIDEO_GENERATIONS, body, {
      skipErrorHandler: true,
    } as Record<string, unknown>)
    const data = response.data?.data ?? response.data
    return {
      taskId: String(data?.task_id ?? data?.id ?? ''),
      status: data?.status,
    }
  } catch (error) {
    const details = parseRequestErrorDetails(error)
    throw new Error(details.errorMessage)
  }
}

export async function generateSpeech(input: {
  model: string
  group: string
  text: string
  settings: StudioSettings
  voiceId?: string
  instructions?: string
}): Promise<Blob> {
  const response = await api.post(
    API_ENDPOINTS.AUDIO_SPEECH,
    {
      model: input.model,
      group: input.group,
      input: input.text,
      voice: input.voiceId || input.settings.voice,
      speed: input.settings.speed,
      response_format: input.settings.audioFormat,
      ...(input.instructions !== undefined
        ? { instructions: input.instructions }
        : {}),
    },
    { responseType: 'blob' }
  )
  return response.data as Blob
}

// ---- Estimate ----

export type PlaygroundEstimateInput = {
  modality: string
  model: string
  group: string
  n?: number
  size?: string
  duration?: number
  has_reference?: boolean
  max_tokens?: number
  /** Rough prompt token hint for token-mode estimates */
  prompt_tokens?: number
}

export type PlaygroundEstimateResult = {
  kind: string
  quota?: number
  amount?: number
  amount_label?: string
  group_ratio: number
  model_price?: number
  model_ratio?: number
  message?: string
}

export async function estimatePlaygroundCost(
  input: PlaygroundEstimateInput
): Promise<PlaygroundEstimateResult | null> {
  try {
    const res = await api.post(API_ENDPOINTS.ESTIMATE, input, {
      skipErrorHandler: true,
    } as Record<string, unknown>)
    if (!res.data?.success) return null
    return res.data.data as PlaygroundEstimateResult
  } catch {
    return null
  }
}

// ---- Assets ----

export type PlaygroundAsset = {
  id: number
  user_id: number
  kind: string
  /** 'library' for curated uploads, 'attachment' for composer attachments. */
  source?: string
  name: string
  storage_key?: string
  upload_state?: '' | 'pending' | 'ready'
  upload_expires_at?: number
  url: string
  mime: string
  size: number
  created_at: number
}

export async function listPlaygroundAssets(params?: {
  kind?: string
  source?: string
  p?: number
  page_size?: number
}): Promise<{ items: PlaygroundAsset[]; total: number }> {
  const res = await api.get(API_ENDPOINTS.ASSETS, { params })
  if (!res.data?.success) return { items: [], total: 0 }
  const data = res.data.data
  return {
    items: (data?.items ?? []) as PlaygroundAsset[],
    total: Number(data?.total ?? 0),
  }
}

export async function uploadPlaygroundAsset(
  file: File,
  kind?: string,
  source?: string
): Promise<PlaygroundAsset> {
  const direct = await uploadPlaygroundAssetDirect(file, kind, source)
  if (direct) return direct
  const form = new FormData()
  form.append('file', file)
  if (kind) form.append('kind', kind)
  if (source) form.append('source', source)
  const res = await api.post(API_ENDPOINTS.ASSETS, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Upload failed')
  }
  return res.data.data as PlaygroundAsset
}

async function uploadPlaygroundAssetDirect(
  file: File,
  kind?: string,
  source?: string
): Promise<PlaygroundAsset | null> {
  if (!kind || kind === 'document' || !file.type) return null
  const intent = await api.post(
    `${API_ENDPOINTS.ASSETS}/upload-intent`,
    {
      name: file.name,
      content_type: file.type || 'application/octet-stream',
      size: file.size,
      kind,
      source,
      create_only: true,
    },
    { skipErrorHandler: true, validateStatus: () => true }
  )
  if (!intent.data?.success || !intent.data?.data?.put_url) {
    if (intent.data?.message === 'direct upload is not available') return null
    throw new Error(intent.data?.message || t('Upload failed'))
  }
  const put = await fetch(intent.data.data.put_url as string, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      ...intent.data.data.put_headers,
    },
  })
  if (!put.ok) {
    throw new Error(`Direct upload failed (${put.status})`)
  }
  const finalized = await api.post(
    `${API_ENDPOINTS.ASSETS}/${intent.data.data.asset.id}/finalize`
  )
  if (
    !finalized.data?.success ||
    finalized.data?.data?.upload_state !== 'ready'
  ) {
    throw new Error(finalized.data?.message || t('Upload failed'))
  }
  return finalized.data.data as PlaygroundAsset
}

/** Fetch the raw bytes of a private asset through the same-origin app route. */
export async function fetchPlaygroundAssetBlob(id: number): Promise<Blob> {
  const res = await api.get(`${API_ENDPOINTS.ASSETS}/${id}/content`, {
    responseType: 'blob',
  })
  return res.data as Blob
}

export type PlaygroundParseOCRContract = {
  model: string
  prompt: string
  page_count: number
  page_urls: string[]
  execution_token: string
}

export type PlaygroundDocumentParseState = {
  status: 'processing' | 'needs_ocr' | 'done' | 'failed'
  parser?: string
  page_count?: number
  text?: string
  error?: string
  ocr?: PlaygroundParseOCRContract
}

/** Start (or resume) the server-side parse of an uploaded document asset. */
export async function startPlaygroundAssetParse(
  id: number,
  group?: string
): Promise<PlaygroundDocumentParseState> {
  const res = await api.post(`${API_ENDPOINTS.ASSETS}/${id}/parse`, { group })
  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Parse failed')
  }
  return res.data.data as PlaygroundDocumentParseState
}

export async function getPlaygroundAssetParse(
  id: number
): Promise<PlaygroundDocumentParseState> {
  const res = await api.get(`${API_ENDPOINTS.ASSETS}/${id}/parse`)
  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Parse unavailable')
  }
  return res.data.data as PlaygroundDocumentParseState
}

export async function importPlaygroundAsset(
  sourceUrl: string,
  kind: 'image' | 'video' | 'audio'
): Promise<PlaygroundAsset> {
  const res = await api.post(`${API_ENDPOINTS.ASSETS}/import`, {
    source_url: sourceUrl,
    kind,
  })
  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Import failed')
  }
  return res.data.data as PlaygroundAsset
}

export async function deletePlaygroundAsset(id: number): Promise<void> {
  await api.delete(`${API_ENDPOINTS.ASSETS}/${id}`)
}

export async function createUploadSession(kind?: string): Promise<{
  token: string
  expires_at: number
  upload_url: string
}> {
  const res = await api.post(API_ENDPOINTS.UPLOAD_SESSIONS, { kind })
  if (!res.data?.success) throw new Error(res.data?.message || 'Session failed')
  return res.data.data
}

export async function getUploadSession(token: string): Promise<{
  token: string
  expires_at: number
  asset_id: number
  asset?: PlaygroundAsset | null
}> {
  const res = await api.get(`${API_ENDPOINTS.UPLOAD_SESSIONS}/${token}`)
  if (!res.data?.success) throw new Error(res.data?.message || 'Not found')
  return res.data.data
}

// ---- Conversations ----

export type ServerConversation = {
  id: number
  title: string
  model: string
  group: string
  kind?: string
  meta_json?: string
  pinned?: boolean
  source?: string
  /** Rolling summary of turns up to the message keyed summary_tail_key. */
  summary?: string
  summary_tail_key?: string
  revision?: number
  active_run_id?: string
  created_at: number
  updated_at: number
}

export type ServerMessage = {
  id: number
  role: string
  content: string
  content_json?: string
  model?: string
  tool_json?: string
  client_key?: string
  seq: number
  created_at?: number
}

export type ServerConversationMessageInput = {
  role: string
  content: string
  content_json?: unknown[]
  model?: string
  tool_json?: unknown
  client_key?: string
  source?: string
  created_at?: number
}

export async function listConversations(params?: {
  p?: number
  page_size?: number
}): Promise<{ items: ServerConversation[]; total: number }> {
  const res = await api.get(API_ENDPOINTS.CONVERSATIONS, { params })
  if (!res.data?.success) return { items: [], total: 0 }
  return {
    items: (res.data.data?.items ?? []) as ServerConversation[],
    total: Number(res.data.data?.total ?? 0),
  }
}

export async function createConversation(input: {
  title?: string
  model?: string
  group?: string
  kind?: 'chat' | 'duo'
  meta_json?: string | Record<string, unknown>
  source?: string
}): Promise<ServerConversation> {
  const res = await api.post(API_ENDPOINTS.CONVERSATIONS, input)
  if (!res.data?.success) throw new Error(res.data?.message || 'Create failed')
  return res.data.data as ServerConversation
}

export async function getConversation(id: number): Promise<{
  conversation: ServerConversation
  messages: ServerMessage[]
}> {
  const res = await api.get(`${API_ENDPOINTS.CONVERSATIONS}/${id}`, {
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  if (!res.data?.success) throw new Error(res.data?.message || 'Not found')
  return res.data.data
}

export async function deleteConversation(id: number): Promise<void> {
  const res = await api.delete(`${API_ENDPOINTS.CONVERSATIONS}/${id}`, {
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  if (!res.data?.success) throw new Error(res.data?.message || 'Delete failed')
}

export async function updateConversation(
  id: number,
  input: {
    title?: string
    model?: string
    group?: string
    kind?: 'chat' | 'duo'
    meta_json?: string | Record<string, unknown>
    pinned?: boolean
  }
): Promise<ServerConversation> {
  const res = await api.patch(`${API_ENDPOINTS.CONVERSATIONS}/${id}`, input, {
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  if (!res.data?.success) throw new Error(res.data?.message || 'Update failed')
  return res.data.data as ServerConversation
}

export async function putConversationMessages(
  id: number,
  messages: ServerConversationMessageInput[]
): Promise<void> {
  const res = await api.put(
    `${API_ENDPOINTS.CONVERSATIONS}/${id}/messages`,
    { messages },
    { skipBusinessError: true, skipErrorHandler: true }
  )
  if (!res.data?.success) throw new Error(res.data?.message || 'Replace failed')
}

export async function appendConversationMessages(
  id: number,
  messages: ServerConversationMessageInput[],
  options?: { longMemory?: boolean }
): Promise<{ messages: ServerMessage[]; appended: number; skipped: number }> {
  const res = await api.post(`${API_ENDPOINTS.CONVERSATIONS}/${id}/messages`, {
    messages,
    long_memory: options?.longMemory === true,
  })
  if (!res.data?.success) throw new Error(res.data?.message || 'Append failed')
  return res.data.data
}

export async function listConversationMessages(
  id: number,
  params?: { since_id?: number; limit?: number }
): Promise<{ messages: ServerMessage[]; has_more: boolean }> {
  const res = await api.get(`${API_ENDPOINTS.CONVERSATIONS}/${id}/messages`, {
    params,
  })
  if (!res.data?.success) throw new Error(res.data?.message || 'Load failed')
  return {
    messages: (res.data.data?.messages ?? []) as ServerMessage[],
    has_more: Boolean(res.data.data?.has_more),
  }
}

export async function listConversationsSince(
  since: number
): Promise<{ items: ServerConversation[]; has_more: boolean }> {
  const res = await api.get(API_ENDPOINTS.CONVERSATIONS, { params: { since } })
  if (!res.data?.success) return { items: [], has_more: false }
  return {
    items: (res.data.data?.items ?? []) as ServerConversation[],
    has_more: Boolean(res.data.data?.has_more),
  }
}

// ---- Studio projects ----

export type ServerProject = {
  id: number
  modality: string
  title: string
  model: string
  group: string
  client_key?: string
  last_prompt?: string
  preview_urls?: string
  created_at: number
  updated_at: number
}

export async function listProjects(params?: {
  p?: number
  page_size?: number
  modality?: string
}): Promise<{ items: ServerProject[]; total: number }> {
  const res = await api.get(API_ENDPOINTS.PROJECTS, { params })
  if (!res.data?.success) return { items: [], total: 0 }
  return {
    items: (res.data.data?.items ?? []) as ServerProject[],
    total: Number(res.data.data?.total ?? 0),
  }
}

export async function createProject(input: {
  modality: string
  title?: string
  model?: string
  group?: string
  client_key?: string
  last_prompt?: string
  preview_urls?: string[]
}): Promise<ServerProject> {
  const res = await api.post(API_ENDPOINTS.PROJECTS, input)
  if (!res.data?.success) throw new Error(res.data?.message || 'Create failed')
  return res.data.data as ServerProject
}

export async function getProject(id: number): Promise<{
  project: ServerProject
  runs: PlaygroundRun[]
}> {
  const res = await api.get(`${API_ENDPOINTS.PROJECTS}/${id}`, {
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  if (!res.data?.success) throw new Error(res.data?.message || 'Not found')
  return res.data.data
}

export async function updateProject(
  id: number,
  input: {
    title?: string
    model?: string
    group?: string
    last_prompt?: string
    preview_urls?: string[]
  }
): Promise<ServerProject> {
  const res = await api.patch(`${API_ENDPOINTS.PROJECTS}/${id}`, input, {
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  if (!res.data?.success) throw new Error(res.data?.message || 'Update failed')
  return res.data.data as ServerProject
}

export async function deleteProject(id: number): Promise<void> {
  const res = await api.delete(`${API_ENDPOINTS.PROJECTS}/${id}`, {
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  if (!res.data?.success) throw new Error(res.data?.message || 'Delete failed')
}

// ---- Personas ----

// ---- Long-term user memories ----

export type PlaygroundUserMemory = {
  id: number
  user_id: number
  content: string
  category: string
  source_conversation_id: number
  created_at: number
  updated_at: number
}

export async function listUserMemories(): Promise<{
  items: PlaygroundUserMemory[]
  enabled: boolean
}> {
  const res = await api.get(API_ENDPOINTS.MEMORIES)
  if (!res.data?.success) return { items: [], enabled: false }
  return {
    items: (res.data.data?.items ?? []) as PlaygroundUserMemory[],
    enabled: Boolean(res.data.data?.enabled),
  }
}

export async function deleteUserMemory(id: number): Promise<void> {
  const res = await api.delete(`${API_ENDPOINTS.MEMORIES}/${id}`)
  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Request error occurred')
  }
}

export async function clearUserMemories(): Promise<void> {
  const res = await api.delete(API_ENDPOINTS.MEMORIES)
  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Request error occurred')
  }
}

export type PlaygroundPersona = {
  id: number
  name: string
  system_prompt: string
  created_at: number
}

export async function listPersonas(): Promise<PlaygroundPersona[]> {
  const res = await api.get(API_ENDPOINTS.PERSONAS)
  if (!res.data?.success) return []
  return (res.data.data ?? []) as PlaygroundPersona[]
}

export async function createPersona(input: {
  name: string
  system_prompt: string
}): Promise<PlaygroundPersona> {
  const res = await api.post(API_ENDPOINTS.PERSONAS, input)
  if (!res.data?.success) throw new Error(res.data?.message || 'Create failed')
  return res.data.data as PlaygroundPersona
}

export async function deletePersona(id: number): Promise<void> {
  await api.delete(`${API_ENDPOINTS.PERSONAS}/${id}`)
}

// ---- Runs / tasks ----

export type PlaygroundRun = {
  id: number
  modality: string
  model: string
  prompt: string
  result_url: string
  asset_id?: number
  project_id?: number
  quota: number
  task_id: string
  batch_id?: string
  created_at: number
}

export async function listPlaygroundTasks(params?: {
  modality?: string
  p?: number
  page_size?: number
}): Promise<{
  tasks: unknown[]
  runs: PlaygroundRun[]
  runTotal: number
}> {
  const res = await api.get(API_ENDPOINTS.PLAYGROUND_TASKS, { params })
  if (!res.data?.success) return { tasks: [], runs: [], runTotal: 0 }
  return {
    tasks: res.data.data?.tasks ?? [],
    runs: (res.data.data?.runs ?? []) as PlaygroundRun[],
    runTotal: Number(res.data.data?.run_total ?? 0),
  }
}

export async function createPlaygroundRun(input: {
  modality: string
  model: string
  prompt: string
  result_url?: string
  asset_id?: number
  project_id?: number
  quota?: number
  task_id?: string
  batch_id?: string
}): Promise<PlaygroundRun | null> {
  try {
    const res = await api.post(API_ENDPOINTS.PLAYGROUND_RUNS, input, {
      skipErrorHandler: true,
    } as Record<string, unknown>)
    if (!res.data?.success) return null
    return res.data.data as PlaygroundRun
  } catch {
    return null
  }
}

// ---- Multi-chat ----

export async function multiChat(input: {
  answer_models: string[]
  summarizer_model: string
  messages: Array<{ role: string; content: string }>
  group?: string
  timeout?: number
}): Promise<{
  legs: Array<{ model: string; content?: string; error?: string }>
  summary: string
  summary_error?: string
  partial?: boolean
}> {
  const res = await api.post(API_ENDPOINTS.CHAT_MULTI, input, {
    skipErrorHandler: true,
    // Align with backend max timeout (300s) so summary is not cut off after legs
    timeout: 310_000,
  } as Record<string, unknown>)
  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Multi-chat failed')
  }
  return res.data.data
}

// ---- Inspiration ----

export type ApiInspirationCategory = {
  id: number
  slug: string
  name: string
}

export async function listInspirationCategories(): Promise<
  ApiInspirationCategory[]
> {
  try {
    const res = await api.get(API_ENDPOINTS.INSPIRATION_CATEGORIES, {
      skipErrorHandler: true,
    } as Record<string, unknown>)
    if (!res.data?.success) return []
    return (res.data.data ?? []) as ApiInspirationCategory[]
  } catch {
    return []
  }
}

export async function listInspirationTemplates(params?: {
  category?: string
  modality?: string
  page_size?: number
}): Promise<InspirationRecipe[]> {
  const res = await api.get(API_ENDPOINTS.INSPIRATION_TEMPLATES, {
    params: { page_size: 50, ...params },
    skipErrorHandler: true,
  } as Record<string, unknown>)
  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Could not load recipes')
  }
  return ((res.data.data?.items ?? []) as InspirationRecipe[]).map(
    normalizeInspirationRecipe
  )
}

export async function getInspirationTemplate(
  slug: string
): Promise<InspirationRecipe> {
  const res = await api.get(`${API_ENDPOINTS.INSPIRATION_TEMPLATES}/${slug}`, {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Could not load recipe')
  }
  return normalizeInspirationRecipe(res.data.data as InspirationRecipe)
}

function normalizeInspirationRecipe(
  recipe: InspirationRecipe
): InspirationRecipe {
  return {
    ...recipe,
    tags: Array.isArray(recipe.tags) ? recipe.tags : [],
    variables: Array.isArray(recipe.variables) ? recipe.variables : [],
    examples: Array.isArray(recipe.examples) ? recipe.examples : [],
    parameters:
      recipe.parameters && typeof recipe.parameters === 'object'
        ? recipe.parameters
        : {},
    model_policy: {
      recommended: Array.isArray(recipe.model_policy?.recommended)
        ? recipe.model_policy.recommended
        : [],
      compatible: Array.isArray(recipe.model_policy?.compatible)
        ? recipe.model_policy.compatible
        : [],
    },
    covers: recipe.covers ?? { small: '', medium: '', large: '' },
  }
}

export async function recordInspirationEvents(
  recipe: InspirationRecipe,
  type: InspirationEventType
): Promise<void> {
  try {
    await api.post(
      '/api/playground/inspiration/events',
      {
        events: [
          {
            event_id: crypto.randomUUID(),
            template_id: recipe.id,
            version_id: recipe.version_id,
            type,
          },
        ],
      },
      { skipErrorHandler: true } as Record<string, unknown>
    )
  } catch {
    /* analytics never blocks UX */
  }
}

export async function getInspirationLibrary(): Promise<InspirationLibrary> {
  const res = await api.get('/api/playground/inspiration/library')
  const data = res.data?.data as Partial<InspirationLibrary> | null | undefined
  return {
    collections: Array.isArray(data?.collections) ? data.collections : [],
    saves: Array.isArray(data?.saves) ? data.saves : [],
  }
}

export async function setInspirationFavorite(
  templateId: number,
  favorite: boolean
): Promise<void> {
  const method = favorite ? api.put : api.delete
  await method(`/api/playground/inspiration/templates/${templateId}/favorite`)
}

export async function createInspirationCollection(
  name: string
): Promise<InspirationCollection> {
  const res = await api.post('/api/playground/inspiration/collections', {
    name,
  })
  return res.data.data as InspirationCollection
}

export async function setInspirationCollectionTemplate(
  collectionId: number,
  templateId: number,
  saved: boolean
): Promise<void> {
  const method = saved ? api.put : api.delete
  await method(
    `/api/playground/inspiration/collections/${collectionId}/templates/${templateId}`
  )
}

// ---- Skill ----

export function skillDownloadUrl(): string {
  return API_ENDPOINTS.SKILL_MD
}

// ---- Voices ----

export type PlaygroundVoice = {
  id: number
  name: string
  asset_id: number
  status: string
  provider_voice_id?: string
  created_at: number
}

export async function listVoices(): Promise<PlaygroundVoice[]> {
  const res = await api.get(API_ENDPOINTS.VOICES)
  if (!res.data?.success) return []
  return (res.data.data ?? []) as PlaygroundVoice[]
}

export async function createVoice(
  file: File,
  name: string
): Promise<PlaygroundVoice> {
  const form = new FormData()
  form.append('file', file)
  form.append('name', name)
  const res = await api.post(API_ENDPOINTS.VOICES, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  if (!res.data?.success) throw new Error(res.data?.message || 'Create failed')
  return (res.data.data?.voice ?? res.data.data) as PlaygroundVoice
}

export async function deleteVoice(id: number): Promise<void> {
  await api.delete(`${API_ENDPOINTS.VOICES}/${id}`)
}
