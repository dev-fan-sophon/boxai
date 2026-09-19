import { nanoid } from 'nanoid'

import { planVideoJobs } from '@/features/playground/lib/studio/video-capabilities'

import type { CanvasConnection, CanvasNodeData } from '../types'
import { createCanvasNode } from './canvas-domain'

const BATCH_GAP = 32
const BATCH_COLUMNS = 3

export type VideoBatchPlan = {
  /** Prompts in generation order; index 0 runs on the root node. */
  prompts: string[]
  /** Jobs dropped because the batch exceeded `MAX_VIDEO_BATCH_JOBS`. */
  truncated: number
}

/**
 * Expands a video node's prompt box into the list of jobs to run. In batch
 * mode every non-empty line is a prompt; `count` repeats each prompt so the
 * user gets several takes. The total is capped at `MAX_VIDEO_BATCH_JOBS`.
 */
export function planVideoBatch(node: CanvasNodeData): VideoBatchPlan {
  const metadata = node.metadata ?? {}
  const plan = planVideoJobs({
    text: metadata.videoBatchMode
      ? (metadata.videoBatchPrompts ?? '')
      : (metadata.prompt ?? ''),
    batchMode: Boolean(metadata.videoBatchMode),
    count: metadata.count ?? 1,
  })
  if (!plan.prompts.length) return { prompts: [''], truncated: 0 }
  return plan
}

/**
 * Creates sibling video nodes for prompts[1..] laid out in a grid to the right
 * of the root, each wired to the root's upstream nodes so references and
 * presets apply identically. The root itself runs prompts[0].
 */
export function createVideoBatchSiblings(
  root: CanvasNodeData,
  prompts: string[],
  connections: CanvasConnection[]
): { nodes: CanvasNodeData[]; connections: CanvasConnection[] } {
  const incoming = connections.filter(
    (connection) => connection.toNodeId === root.id
  )
  const nodes: CanvasNodeData[] = []
  const newConnections: CanvasConnection[] = []

  prompts.slice(1).forEach((prompt, index) => {
    const column = index % BATCH_COLUMNS
    const row = Math.floor(index / BATCH_COLUMNS)
    const x = root.position.x + (root.width + BATCH_GAP) * (column + 1)
    const y = root.position.y + (root.height + BATCH_GAP) * row
    const child = createCanvasNode(
      root.type,
      { x: x + root.width / 2, y: y + root.height / 2 },
      {
        prompt,
        model: root.metadata?.model,
        aspectRatio: root.metadata?.aspectRatio,
        resolution: root.metadata?.resolution,
        seconds: root.metadata?.seconds,
        generateAudio: root.metadata?.generateAudio,
        videoReferenceMode: root.metadata?.videoReferenceMode,
        disableLastFrame: root.metadata?.disableLastFrame,
        batchRootId: root.id,
        status: 'idle',
      }
    )
    child.width = root.width
    child.height = root.height
    child.position = { x, y }
    child.parentId = root.parentId
    child.title = `${root.title} ${index + 2}`
    nodes.push(child)
    incoming.forEach((connection) => {
      newConnections.push({
        ...connection,
        id: `conn-${nanoid(8)}`,
        toNodeId: child.id,
      })
    })
  })

  return { nodes, connections: newConnections }
}
