import {
  buildPlaygroundDocument,
  preparePlaygroundDocumentRun,
  sendChatCompletion,
  type DocumentBuildAsset,
  type DocumentBuildResponse,
} from '../api'
import type { ManagedDocumentArtifact, Message } from '../types'
import { getCurrentVersion } from './message/message-utils'

const FENCE = /```[ \t]*([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g

/**
 * Pulls the build script out of a chat reply.
 *
 * Models add commentary around the block however firmly the prompt forbids it, and weaker ones
 * emit a sketch before the real script. The last python block is the one they meant; an untagged
 * block is accepted so a missing language tag does not cost the user an attempt.
 *
 * This mirrors ExtractPlaygroundDocumentCode in the Go service, which validates the same reply
 * shape server-side.
 */
export function extractDocumentBuildCode(reply: string): string {
  let selected = ''
  for (const match of reply.matchAll(FENCE)) {
    const language = (match[1] || '').trim().toLowerCase()
    const code = (match[2] || '').trim()
    if (!code) continue
    if (language === 'python' || language === 'py') {
      selected = code
      continue
    }
    if (!language && !selected) selected = code
  }
  if (selected) return selected

  const trimmed = reply.trim()
  if (trimmed.includes('import ') && trimmed.includes('/workspace/out')) {
    return trimmed
  }
  return ''
}

export function toDocumentArtifacts(
  assets: DocumentBuildAsset[] | undefined,
  unverified: string[] | undefined
): ManagedDocumentArtifact[] {
  const failed = new Set(unverified ?? [])
  return (assets ?? []).map((asset) => ({
    assetId: asset.id,
    name: asset.name,
    url: asset.url,
    mime: asset.mime,
    size: asset.size,
    verified: !failed.has(asset.name),
  }))
}

export type DocumentBuildOutcome = {
  result: DocumentBuildResponse
  code: string
  attempts: number
}

// Tail cap keeps the build call affordable while keeping the most recent
// turns, which are the ones a "make this a document" request refers to.
const MAX_DOCUMENT_CONTEXT_CHARS = 12000

/**
 * The chat transcript the build model writes the document FROM. Without it,
 * "make this a PDF" reaches the model as a bare instruction and it invents
 * plausible content instead of using the conversation.
 */
export function buildDocumentConversationContext(messages: Message[]): string {
  const blocks: string[] = []
  for (const message of messages) {
    if (message.from !== 'user' && message.from !== 'assistant') continue
    const content = getCurrentVersion(message).content.trim()
    if (!content) continue
    blocks.push(
      `${message.from === 'user' ? 'User' : 'Assistant'}:\n${content}`
    )
  }
  const context = blocks.join('\n\n')
  if (context.length > MAX_DOCUMENT_CONTEXT_CHARS) {
    return context.slice(-MAX_DOCUMENT_CONTEXT_CHARS)
  }
  return context
}

/**
 * Drives one document request from intent to files.
 *
 * Each attempt is an ordinary billed chat call, because that is how every model invocation in
 * this app is billed. The server owns everything that must not be client-controlled: which files
 * the sandbox may read, which document an edit is based on, and how many attempts are left. When
 * the server says the attempts are gone, `can_retry` is false and the loop stops regardless of
 * what this function would otherwise do.
 */
export async function runDocumentBuild(input: {
  runId: number
  executionToken: string
  model: string
  group: string
  userText: string
  conversationContext?: string
  conversationId?: number
  assetIds?: number[]
  signal?: AbortSignal
  onAttempt?: (attempt: number) => void
  onStage?: (stage: 'generate' | 'build', attempt: number) => void
}): Promise<DocumentBuildOutcome> {
  const prepared = await preparePlaygroundDocumentRun(input.runId, {
    execution_token: input.executionToken,
    conversation_id: input.conversationId,
    asset_ids: input.assetIds,
  })

  let systemPrompt = prepared.system_prompt
  const userMessage = input.conversationContext
    ? `Conversation so far. The document's content must come from here, not be invented:\n\n${input.conversationContext}\n\n---\n\nBuild request: ${input.userText}`
    : input.userText
  let attempt = 0
  // The server is the authority on the cap; this only stops a runaway loop if it ever stopped
  // saying so.
  for (let guard = 0; guard < 5; guard += 1) {
    attempt += 1
    input.onAttempt?.(attempt)
    input.onStage?.('generate', attempt)

    const reply = await sendChatCompletion(
      {
        model: input.model,
        group: input.group,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      },
      input.signal
    )
    const content = reply.choices?.[0]?.message?.content ?? ''
    const code = extractDocumentBuildCode(content)
    if (!code) {
      throw new Error('The model did not return a build script')
    }

    input.onStage?.('build', attempt)
    const result = await buildPlaygroundDocument(input.runId, {
      execution_token: input.executionToken,
      code,
    })
    if (result.status === 'completed') {
      return { result, code, attempts: attempt }
    }
    if (!result.can_retry || !result.retry_prompt) {
      throw new Error(result.error || 'The document could not be built')
    }
    systemPrompt = result.retry_prompt
  }
  throw new Error('The document could not be built')
}
