import { generateText, tool } from 'ai'
import { z } from 'zod'

import { userModel } from '../engine/provider'
import { buildDocument, prepareDocumentBuild } from '../gateway/client'
import type { DocumentBuildResponse } from '../gateway/client'
import type { ToolContext } from './index'

const documentFence = /```[ \t]*([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g

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
    execute: async ({ request }, options) => {
      const externalRunId = crypto.randomUUID()
      const prepared = await prepareDocumentBuild(context.userId, {
        request_text: request,
        conversation_id: context.conversationId,
        asset_ids: context.assetIds,
      })

      let authoringSystem = prepared.system_prompt
      let outcome: DocumentBuildResponse | undefined
      for (let attempt = 1; attempt <= prepared.max_attempts; attempt++) {
        if (options?.abortSignal?.aborted) {
          throw new Error('document build was cancelled')
        }
        const authored = await generateText({
          model: userModel(context.userId, context.modelId),
          system: authoringSystem,
          prompt: request,
          abortSignal: options?.abortSignal,
        })
        const code = extractDocumentCode(authored.text)
        if (!code) {
          throw new Error('the model did not return a build script')
        }
        outcome = await buildDocument(context.userId, {
          external_run_id: externalRunId,
          conversation_id: context.conversationId,
          asset_ids: context.assetIds,
          formats: prepared.formats,
          previous_keys: prepared.previous_keys,
          previous_names: prepared.previous_names,
          code,
          chat_model: context.modelId,
        })
        if (outcome.status === 'completed') {
          return {
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
