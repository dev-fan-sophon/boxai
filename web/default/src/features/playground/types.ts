import type { UIMessage } from 'ai'

import type { ReasoningEffort, ReasoningLevel } from '../pricing/types'

// Message types
export type MessageRole = 'user' | 'assistant' | 'system'

export type MessageStatus =
  | 'loading'
  | 'streaming'
  | 'complete'
  | 'stopped'
  | 'error'

export type ManagedToolStatus =
  | 'queued'
  | 'running'
  | 'submitted'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type ManagedDocumentArtifact = {
  assetId: number
  name: string
  url?: string
  mime: string
  size: number
  /** False when the file could not be reopened by the library that owns its format. */
  verified: boolean
}

export type ManagedToolCard = {
  runId?: number
  toolCallId?: string
  action:
    | 'generate_image'
    | 'generate_video'
    | 'web_search'
    | 'generate_document'
  status: ManagedToolStatus
  model?: string
  taskId?: string
  images?: string[]
  videoUrl?: string
  error?: string
  /** i18n key of the current phase, shown while running so long tools don't look frozen. */
  stage?: string
  /** Free-text companion to the stage (search query, file being written). */
  stageDetail?: string
  /** Epoch ms when the tool started; drives the live elapsed timer on the card. */
  startedAt?: number
  documents?: ManagedDocumentArtifact[]
  /** The script the model wrote, shown in a collapsed panel for trust and debugging. */
  documentCode?: string
  documentLogs?: string
  /** How many builds it took, so a document that needed self-heal is not silently equal to one
   *  that worked first time. */
  documentAttempts?: number
}

export type MessageSource = {
  href: string
  title: string
  snippet?: string
  domain?: string
  publishedAt?: string
}

export type PlaygroundMessageLayoutMode = 'alternating' | 'left'

export type MessageTokenUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface MessageVersion {
  id: string
  content: string
}

type ChatAttachmentBase = {
  id: string
  name: string
  mimeType: string
}

/**
 * Image backed by a playground asset. `dataUrl` holds the bytes for the
 * current tab; after a reload only `assetId` survives and the bytes are
 * refetched before the next request.
 */
export type ChatImageAttachment = ChatAttachmentBase & {
  kind: 'image'
  dataUrl?: string
  assetId?: number
}

export type ChatDocumentParseStatus = 'processing' | 'ocr' | 'done' | 'failed'

/**
 * Document attachment. Only extracted text ever reaches the model, so any
 * chat model can consume any document. Plain-text files are read in the
 * browser; PDF/Office files are uploaded (`assetId`) and parsed server-side,
 * with `status` tracking that pipeline. Absent status means done (legacy).
 */
export type ChatDocumentAttachment = ChatAttachmentBase & {
  kind: 'document'
  text: string
  assetId?: number
  status?: ChatDocumentParseStatus
  error?: string
  /** OCR progress while status is 'ocr' */
  ocrDone?: number
  ocrTotal?: number
}

export type ChatAttachment = ChatImageAttachment | ChatDocumentAttachment

export interface Message {
  key: string
  from: MessageRole
  versions: MessageVersion[]
  /** Native AI SDK parts. Agent messages render this array in source order. */
  parts?: UIMessage['parts']
  /**
   * Index of the displayed version. Regenerate appends a version instead of
   * overwriting; absent means the latest version.
   */
  activeVersion?: number
  /** Inline images and PDFs attached to a user turn */
  attachments?: ChatAttachment[]
  createdAt?: number
  startedAt?: number
  completedAt?: number
  durationMs?: number
  sources?: MessageSource[]
  managedTool?: ManagedToolCard
  /** Every AI SDK tool part in this assistant turn, preserved in call order. */
  managedTools?: ManagedToolCard[]
  /**
   * Model that produced this assistant turn. Absent on legacy messages
   * (shown as "model not recorded").
   */
  model?: string
  /**
   * Legacy mid-thread model-switch marker. No longer written; filtered out of
   * the transcript UI and API payload. Kept for persisted session compat.
   */
  modelChangeFrom?: string
  modelChangeTo?: string
  reasoning?: {
    content: string
    duration?: number
    startedAt?: number
    completedAt?: number
    durationMs?: number
  }
  isReasoningStreaming?: boolean
  isReasoningComplete?: boolean
  isContentComplete?: boolean
  status?: MessageStatus
  errorCode?: string | null
  usage?: MessageTokenUsage
}

// API payload types
export interface ChatCompletionMessage {
  role: MessageRole | 'tool'
  content: string | ContentPart[]
  tool_calls?: ChatToolCall[]
  tool_call_id?: string
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type ChatToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatToolCallDelta = {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

export type ChatToolDefinition = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export interface ChatCompletionRequest {
  model: string
  group?: string
  messages: ChatCompletionMessage[]
  stream: boolean
  stream_options?: { include_usage: boolean }
  temperature?: number
  top_p?: number
  max_tokens?: number
  frequency_penalty?: number
  presence_penalty?: number
  seed?: number
  tools?: ChatToolDefinition[]
  tool_choice?: 'auto'
}

export interface ChatCompletionChunk {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: MessageRole
      content?: string
      reasoning_content?: string
      tool_calls?: ChatToolCallDelta[]
    }
    finish_reason: string | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  } | null
}

export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: MessageRole
      content: string
      reasoning_content?: string
      tool_calls?: ChatToolCall[]
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// Configuration types
export interface PlaygroundConfig {
  model: string
  group: string
  reasoningByModel: Record<string, ReasoningLevel>
  temperature: number
  top_p: number
  max_tokens: number
  frequency_penalty: number
  presence_penalty: number
  seed: number | null
  stream: boolean
}

export interface ParameterEnabled {
  temperature: boolean
  top_p: boolean
  max_tokens: boolean
  frequency_penalty: boolean
  presence_penalty: boolean
  seed: boolean
}

// Model and group options
export interface ModelOption {
  label: string
  value: string
  reasoningEfforts?: ReasoningEffort[]
}

export interface GroupOption {
  label: string
  value: string
  ratio: number
  desc?: string
}

export type StudioModality = 'chat' | 'image' | 'video' | 'audio'

export type StudioSettings = {
  imageCount: number
  imageSize: string
  imageQuality: string
  videoDuration: number
  videoSize: string
  voice: string
  speed: number
  audioFormat: string
}

export type GeneratedImage = {
  url: string
  revisedPrompt?: string
  /** Set when the image was persisted to a playground asset before display. */
  assetId?: number
}

export type VideoSubmission = {
  taskId: string
  status?: string
}
