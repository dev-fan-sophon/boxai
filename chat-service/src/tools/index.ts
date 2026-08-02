import type { ToolSet } from 'ai'

import { generateDocumentTool } from './generate-document'
import { generateImageTool } from './generate-image'
import { generateVideoTool } from './generate-video'
import { webSearchTool } from './web-search'

/**
 * Tool registry. Each tool module exports a factory taking the run context;
 * registering a capability here is the only step a new tool needs. The model
 * plans multi-step turns natively ("search, then build a document from the
 * results"), which replaced the gateway's one-action-per-turn classifier.
 */

export type ToolContext = {
  userId: number
  group: string
  /** The model the user is chatting with; tools may bill their own calls. */
  modelId: string
  conversationId?: number
  /** Server-side attachment ids from the current turn, for document inputs. */
  assetIds?: number[]
}

export type AgentToolMode =
  | 'auto'
  | 'image'
  | 'video'
  | 'search'
  | 'document'

export type AgentToolName =
  | 'web_search'
  | 'generate_image'
  | 'generate_video'
  | 'generate_document'

const forcedToolByMode: Partial<Record<AgentToolMode, AgentToolName>> = {
  image: 'generate_image',
  video: 'generate_video',
  search: 'web_search',
  document: 'generate_document',
}

export function buildTools(
  context: ToolContext,
  mode: AgentToolMode = 'auto'
): { tools: ToolSet; forceTool?: AgentToolName } {
  const tools: ToolSet = {
    web_search: webSearchTool(context),
    generate_image: generateImageTool(context),
    generate_video: generateVideoTool(context),
    generate_document: generateDocumentTool(context),
  }
  const forceTool = forcedToolByMode[mode]
  if (!forceTool) return { tools }
  return { tools: { [forceTool]: tools[forceTool]! }, forceTool }
}
