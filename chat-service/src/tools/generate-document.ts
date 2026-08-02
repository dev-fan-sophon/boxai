import { generateText, tool } from 'ai'
import { z } from 'zod'

import { userModel } from '../engine/provider'
import { buildDocument, prepareDocumentBuild } from '../gateway/client'
import type { DocumentBuildResponse } from '../gateway/client'
import type { ToolContext } from './index'

const documentFence = /```[ \t]*([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g

type DocumentToolProgress = {
  status: 'running'
  stage:
    | 'Preparing the document'
    | 'Writing the document'
    | 'Building the document'
    | 'Repairing the document'
  attempt?: number
  totalAttempts?: number
}

/**
 * Port of the gateway's ExtractPlaygroundDocumentCode: models wrap the script
 * in commentary and sometimes emit several blocks; the last python block is
 * the one they meant, an untagged block is a fallback, and bare code is
 * accepted only when it looks like a script.
 */
export function extractDocumentCode(reply: string): string {
  let selected = ''
  for (const match of reply.matchAll(documentFence)) {
    const language = (match[1] ?? '').trim().toLowerCase()
    const code = (match[2] ?? '').trim()
    if (!code) {
      continue
    }
    if (language === 'python' || language === 'py') {
      selected = code
      continue
    }
    if (language === '' && !selected) {
      selected = code
    }
  }
  if (selected) {
    return selected
  }
  const trimmed = reply.trim()
  if (trimmed.includes('import ') && trimmed.includes('/workspace/out')) {
    return trimmed
  }
  return ''
}

export function generateDocumentTool(context: ToolContext) {
  return tool({
    description:
      'Create a downloadable document file (PDF, Word, Excel, PowerPoint, ' +
      'CSV). Use when the user asks for a document, report, spreadsheet, ' +
      'slide deck, or asks to export/convert content into a file. Provide ' +
      'the full content the document should contain.',
    inputSchema: z.object({
      request: z
        .string()
        .min(1)
        .max(100_000)
        .describe(
          'What to build, including the full content or source material ' +
            'the document should be produced from'
        ),
    }),
    execute: async function* ({ request }, options) {
      const signal = options?.abortSignal
      const externalRunId = crypto.randomUUID()
      yield {
        status: 'running',
        stage: 'Preparing the document',
      } satisfies DocumentToolProgress
      const prepared = await prepareDocumentBuild(
        context.userId,
        {
          request_text: request,
          group: context.group,
          conversation_id: context.conversationId,
          asset_ids: context.assetIds,
        },
        signal
      )

      let authoringSystem = prepared.system_prompt
      let outcome: DocumentBuildResponse | undefined
      for (let attempt = 1; attempt <= prepared.max_attempts; attempt++) {
        signal?.throwIfAborted()
        yield {
          status: 'running',
          stage:
            attempt === 1
              ? 'Writing the document'
              : 'Repairing the document',
          attempt,
          totalAttempts: prepared.max_attempts,
        } satisfies DocumentToolProgress
        const authored = await generateText({
          model: userModel(context.userId, context.modelId, context.group),
          system: authoringSystem,
          prompt: request,
          abortSignal: signal,
        })
        const code = extractDocumentCode(authored.text)
        if (!code) {
          throw new Error('the model did not return a build script')
        }
        yield {
          status: 'running',
          stage: 'Building the document',
          attempt,
          totalAttempts: prepared.max_attempts,
        } satisfies DocumentToolProgress
        outcome = await buildDocument(
          context.userId,
          {
            external_run_id: externalRunId,
            group: context.group,
            conversation_id: context.conversationId,
            asset_ids: context.assetIds,
            formats: prepared.formats,
            previous_keys: prepared.previous_keys,
            previous_names: prepared.previous_names,
            code,
            chat_model: context.modelId,
          },
          signal
        )
        if (outcome.status === 'completed') {
          yield {
            status: 'completed' as const,
            documents: (outcome.assets ?? []).map((asset) => ({
              asset_id: asset.id,
              name: asset.name,
              mime: asset.mime,
              size: asset.size,
              url: asset.url,
            })),
            attempts: outcome.attempt,
            unverified: outcome.unverified ?? [],
          }
          return
        }
        if (!outcome.can_retry || !outcome.retry_prompt) {
          break
        }
        authoringSystem = outcome.retry_prompt
      }
      throw new Error(outcome?.error || 'document build failed')
    },
  })
}
