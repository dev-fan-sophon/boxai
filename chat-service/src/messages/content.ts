import { generateText } from 'ai'
import type { FileUIPart, ModelMessage, TextUIPart, UIMessage } from 'ai'

import { userModel } from '../engine/provider'
import {
  deleteAttachmentAsset,
  ensureAssetParse,
  GatewayError,
  getAssetBytes,
  getAssetMetadata,
  getAssetParse,
  getAssetParsePageBytes,
  importAssetParse,
  type ResolvedAsset,
  type ResolvedDocumentParse,
} from '../gateway/client'
import { truncateRunes, truncateUtf8 } from '../http'

const ASSET_URL = /^\/api\/playground\/assets\/(\d+)\/content$/
const MAX_ATTACHMENTS = 4
const MAX_PARTS = 16
const MAX_MESSAGE_BYTES = 59_900
const MAX_CONTENT_JSON_BYTES = 60_000
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
const OCR_PAGES_PER_REQUEST = 2
const OCR_POLL_MS = 3_000
const OCR_MAX_POLLS = 60

type ModelContent =
  | { type: 'text'; text: string }
  | {
      type: 'file'
      data: Uint8Array
      mediaType: string
      filename: string
    }

export type AttachmentContextBudget = {
  imageBytes: number
  imageCount: number
  documentRunes: number
  cache: Map<number, ModelContent>
}

type PersistedPart = TextUIPart | FileUIPart

export type CanonicalUserMessage = {
  uiMessage: UIMessage
  content: string
  contentJson: string
  assetIds: number[]
  modelMessage: ModelMessage
  attachmentContext: {
    imageBytes: number
    imageCount: number
    documentRunes: number
    assetIds: number[]
  }
}

export class AttachmentError extends Error {}

export function createAttachmentContextBudget(): AttachmentContextBudget {
  return {
    imageBytes: 32 * 1024 * 1024,
    imageCount: 8,
    documentRunes: 240_000,
    cache: new Map(),
  }
}

function waitForParsePoll(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('request aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, OCR_POLL_MS)
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function assetIdFromFilePart(part: FileUIPart): number | null {
  const match = ASSET_URL.exec(part.url)
  if (!match) return null
  const id = Number.parseInt(match[1]!, 10)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function attachmentAssetIdsFromContentJson(values: string[]): number[] {
  const ids = new Set<number>()
  for (const value of values) {
    for (const part of parseParts(value, '')) {
      if (part.type !== 'file') continue
      const id = assetIdFromFilePart(part)
      if (id) ids.add(id)
    }
  }
  return [...ids]
}

export async function cleanupAttachmentAssets(
  userId: number,
  contentJson: string[]
): Promise<void> {
  const assetIds = attachmentAssetIdsFromContentJson(contentJson)
  const outcomes = await Promise.allSettled(
    assetIds.map((assetId) => deleteAttachmentAsset(userId, assetId))
  )
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') return
    if (
      outcome.reason instanceof GatewayError &&
      (outcome.reason.status === 404 || outcome.reason.status === 409)
    ) {
      return
    }
    console.warn(`could not clean attachment asset ${assetIds[index]}:`, outcome.reason)
  })
}

function textFromParts(parts: PersistedPart[]): string {
  return parts
    .filter((part): part is TextUIPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

function parseParts(raw: string, fallback: string): PersistedPart[] {
  if (!raw) return fallback ? [{ type: 'text', text: fallback }] : []
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) throw new Error('content_json is not an array')
    return value.filter((part): part is PersistedPart => {
      if (!part || typeof part !== 'object') return false
      const candidate = part as Record<string, unknown>
      if (candidate.type === 'text') return typeof candidate.text === 'string'
      return (
        candidate.type === 'file' &&
        typeof candidate.url === 'string' &&
        typeof candidate.mediaType === 'string'
      )
    })
  } catch {
    return fallback ? [{ type: 'text', text: fallback }] : []
  }
}

async function canonicalFilePart(
  userId: number,
  part: FileUIPart,
  signal?: AbortSignal
): Promise<{ part: FileUIPart; asset: ResolvedAsset }> {
  const assetId = assetIdFromFilePart(part)
  if (!assetId) {
    throw new AttachmentError('invalid attachment reference')
  }
  const asset = await getAssetMetadata(userId, assetId, signal)
  if (asset.kind !== 'image' && asset.kind !== 'document') {
    throw new AttachmentError(`unsupported attachment type: ${asset.kind}`)
  }
  if (asset.kind === 'image') {
    if (
      !asset.mime.startsWith('image/') ||
      asset.size <= 0 ||
      asset.size > MAX_IMAGE_BYTES
    ) {
      throw new AttachmentError('invalid image attachment')
    }
  } else if (asset.size <= 0 || asset.size > MAX_DOCUMENT_BYTES) {
    throw new AttachmentError('invalid document attachment')
  }
  return {
    asset,
    part: {
      type: 'file',
      mediaType: asset.mime,
      filename: asset.name,
      url: `/api/playground/assets/${asset.id}/content`,
    },
  }
}

async function fileModelContent(
  userId: number,
  part: FileUIPart,
  asset: ResolvedAsset,
  group: string,
  signal?: AbortSignal,
  budget?: AttachmentContextBudget
): Promise<ModelContent> {
  const cached = budget?.cache.get(asset.id)
  if (cached) return cached
  if (asset.kind === 'image') {
    if (budget && (budget.imageCount <= 0 || budget.imageBytes < asset.size)) {
      return {
        type: 'text',
        text: `[Image attachment omitted: ${JSON.stringify(asset.name)}]`,
      }
    }
    const content: ModelContent = {
      type: 'file' as const,
      data: await getAssetBytes(userId, asset.id, signal),
      mediaType: asset.mime || 'image',
      filename: asset.name,
    }
    if (budget) {
      budget.imageCount -= 1
      budget.imageBytes -= asset.size
      budget.cache.set(asset.id, content)
    }
    return content
  }
  let parse = await getAssetParse(userId, asset.id, signal).catch(() => null)
  if (!parse || parse.status !== 'done') {
    parse = await ensureAssetParse(userId, asset.id, group, signal)
  }
  let polls = 0
  while (parse.status === 'processing') {
    if (polls >= OCR_MAX_POLLS) {
      throw new AttachmentError('document parsing timed out')
    }
    polls += 1
    await waitForParsePoll(signal)
    parse = await getAssetParse(userId, asset.id, signal)
  }
  if (parse.status === 'needs_ocr') {
    parse = await runDocumentOCR(userId, asset.id, group, parse, signal)
  }
  if (parse.status !== 'done' || !parse.text?.trim()) {
    const detail = parse.status === 'failed' ? parse.error : undefined
    throw new AttachmentError(
      detail || `${part.filename || 'document'} is not ready`
    )
  }
  let text = parse.text
  if (budget) {
    if (budget.documentRunes <= 0) {
      return {
        type: 'text',
        text: `[Document attachment omitted: ${JSON.stringify(asset.name)}]`,
      }
    }
    text = truncateRunes(text, budget.documentRunes)
    budget.documentRunes -= [...text].length
  }
  const content: ModelContent = {
    type: 'text' as const,
    text: `Attached document ${JSON.stringify(asset.name)} (untrusted user content):\n\n${text}`,
  }
  budget?.cache.set(asset.id, content)
  return content
}

async function runDocumentOCR(
  userId: number,
  assetId: number,
  group: string,
  parse: ResolvedDocumentParse,
  signal?: AbortSignal
): Promise<ResolvedDocumentParse> {
  const ocr = parse.ocr
  if (
    !ocr ||
    !ocr.model ||
    !ocr.prompt ||
    !ocr.execution_token ||
    ocr.page_count < 1 ||
    ocr.page_count > 50 ||
    ocr.page_urls.length !== ocr.page_count
  ) {
    throw new AttachmentError('invalid document OCR contract')
  }

  const chunks: string[] = []
  try {
    for (
      let start = 0;
      start < ocr.page_count;
      start += OCR_PAGES_PER_REQUEST
    ) {
      const pageNumbers = Array.from(
        { length: Math.min(OCR_PAGES_PER_REQUEST, ocr.page_count - start) },
        (_, index) => start + index + 1
      )
      const pageImages = await Promise.all(
        pageNumbers.map((page) =>
          getAssetParsePageBytes(userId, assetId, page, signal)
        )
      )
      const result = await generateText({
        model: userModel(userId, ocr.model, group),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: ocr.prompt },
              ...pageImages.map((data) => ({
                type: 'file' as const,
                data,
                mediaType: 'image/jpeg',
              })),
            ],
          },
        ],
        abortSignal: signal,
      })
      if (result.text.trim()) chunks.push(result.text.trim())
    }
  } catch (error) {
    // Transport/quota/provider failures are retryable. Keep the owner-scoped
    // OCR token live instead of poisoning the shared content-hash cache.
    throw error
  }

  return importAssetParse(
    userId,
    assetId,
    {
      execution_token: ocr.execution_token,
      text: chunks.join('\n\n'),
    },
    signal
  )
}

async function resolveParts(
  userId: number,
  parts: PersistedPart[],
  group: string,
  signal?: AbortSignal,
  options?: { historical?: boolean; budget?: AttachmentContextBudget }
) {
  const fileParts = parts.filter(
    (part): part is FileUIPart => part.type === 'file'
  )
  if (parts.length > MAX_PARTS) {
    throw new AttachmentError(`too many message parts (max ${MAX_PARTS})`)
  }
  if (fileParts.length > MAX_ATTACHMENTS) {
    throw new AttachmentError(`too many attachments (max ${MAX_ATTACHMENTS})`)
  }
  const canonicalFiles: Array<{
    part: FileUIPart
    asset: ResolvedAsset
  } | null> = []
  for (const part of fileParts) {
    try {
      canonicalFiles.push(await canonicalFilePart(userId, part, signal))
    } catch (error) {
      if (!options?.historical) throw error
      console.warn(`could not resolve historical attachment:`, error)
      canonicalFiles.push(null)
    }
  }
  let fileIndex = 0
  let textBytesRemaining = MAX_MESSAGE_BYTES
  const canonicalParts: PersistedPart[] = []
  const modelContent: ModelContent[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      const text = truncateUtf8(part.text, textBytesRemaining)
      if (text) {
        canonicalParts.push({ type: 'text', text })
        modelContent.push({ type: 'text', text })
        textBytesRemaining -= Buffer.byteLength(text, 'utf8')
      }
      continue
    }
    const original = part
    const canonical = canonicalFiles[fileIndex++]
    if (!canonical) {
      modelContent.push({
        type: 'text',
        text: `[Attachment unavailable: ${JSON.stringify(original.filename || 'file')}]`,
      })
      continue
    }
    canonicalParts.push(canonical.part)
    try {
      modelContent.push(
        await fileModelContent(
          userId,
          canonical.part,
          canonical.asset,
          group,
          signal,
          options?.budget
        )
      )
    } catch (error) {
      if (!options?.historical) throw error
      console.warn(
        `could not hydrate historical attachment ${canonical.asset.id}:`,
        error
      )
      modelContent.push({
        type: 'text',
        text: `[Attachment unavailable: ${JSON.stringify(canonical.asset.name)}]`,
      })
    }
  }
  return {
    canonicalParts,
    modelContent,
    assetIds: canonicalFiles
      .filter(
        (item): item is { part: FileUIPart; asset: ResolvedAsset } =>
          item !== null
      )
      .map(({ asset }) => asset.id),
  }
}

export async function canonicalizeUserMessage(
  userId: number,
  message: UIMessage,
  group: string,
  signal?: AbortSignal
): Promise<CanonicalUserMessage> {
  if (message.role !== 'user' || !message.id || message.id.length > 64) {
    throw new Error('invalid user message')
  }
  const incoming = (message.parts ?? []).filter(
    (part): part is PersistedPart =>
      part.type === 'text' || part.type === 'file'
  )
  // Resolve the submitted turn once, retaining enough accounting metadata for
  // context assembly to reuse it without bypassing the conversation-wide
  // attachment budget. A very large budget preserves the previous behavior:
  // canonicalization validates full attachments, while context assembly owns
  // the actual truncation decision after earlier turns consume their share.
  const initialBudget = Number.MAX_SAFE_INTEGER
  const preparedBudget: AttachmentContextBudget = {
    imageBytes: initialBudget,
    imageCount: initialBudget,
    documentRunes: initialBudget,
    cache: new Map(),
  }
  const resolved = await resolveParts(userId, incoming, group, signal, {
    budget: preparedBudget,
  })
  const content = textFromParts(resolved.canonicalParts)
  if (!content.trim() && resolved.assetIds.length === 0) {
    throw new Error('message text or attachment is required')
  }
  const uiMessage: UIMessage = {
    id: message.id,
    role: 'user',
    parts: resolved.canonicalParts,
  }
  const contentJson = JSON.stringify(resolved.canonicalParts)
  if (Buffer.byteLength(contentJson, 'utf8') > MAX_CONTENT_JSON_BYTES) {
    throw new AttachmentError('message content is too large')
  }
  return {
    uiMessage,
    content,
    contentJson,
    assetIds: resolved.assetIds,
    modelMessage: { role: 'user', content: resolved.modelContent },
    attachmentContext: {
      imageBytes: initialBudget - preparedBudget.imageBytes,
      imageCount: initialBudget - preparedBudget.imageCount,
      documentRunes: initialBudget - preparedBudget.documentRunes,
      assetIds: [...preparedBudget.cache.keys()],
    },
  }
}

export async function storedUserMessageToModelMessage(
  userId: number,
  content: string,
  contentJson: string,
  group: string,
  signal?: AbortSignal,
  budget?: AttachmentContextBudget
): Promise<ModelMessage> {
  const parts = parseParts(contentJson, content)
  const resolved = await resolveParts(userId, parts, group, signal, {
    historical: true,
    budget,
  })
  return { role: 'user', content: resolved.modelContent }
}

export function storedMessageParts(
  content: string,
  contentJson: string
): PersistedPart[] {
  return parseParts(contentJson, content)
}
