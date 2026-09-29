import { CanvasNodeType, type CanvasNodeData, type Position } from '../types'
import { createCanvasNode } from './canvas-domain'

/** Children per row when an image batch is expanded onto the canvas. */
export const IMAGE_BATCH_COLUMNS = 5
/** Spacing between batch slots, shared by every image grid on the canvas. */
export const IMAGE_BATCH_GAP = 24

/**
 * Canvas position of batch child `index` (0-based, root excluded): a grid to
 * the right of the root using the root's size, so a 10-image batch expands
 * into two tidy rows instead of one long strip.
 */
export function imageBatchSlotPosition(
  root: CanvasNodeData,
  index: number
): Position {
  const column = index % IMAGE_BATCH_COLUMNS
  const row = Math.floor(index / IMAGE_BATCH_COLUMNS)
  return {
    x: root.position.x + (root.width + IMAGE_BATCH_GAP) * (column + 1),
    y: root.position.y + (root.height + IMAGE_BATCH_GAP) * row,
  }
}

export type ImageBatchSlotPlan = {
  /** Existing children regenerated in place, in slot order. */
  reuseIds: string[]
  /** New placeholder children for slots the previous batch did not have. */
  created: CanvasNodeData[]
  /** Children of a larger previous batch that no longer have a slot. */
  removeIds: string[]
}

/**
 * Maps a regenerate with `count` images onto the root's current children.
 * Regenerating overwrites results slot by slot, like the root itself; the
 * store's undo history is the way back.
 */
export function planImageBatchSlots(
  root: CanvasNodeData,
  nodes: CanvasNodeData[],
  count: number
): ImageBatchSlotPlan {
  const present = new Set(nodes.map((node) => node.id))
  const existing = (root.metadata?.batchChildIds ?? []).filter((id) =>
    present.has(id)
  )
  const needed = Math.max(0, count - 1)
  const reuseIds = existing.slice(0, needed)
  const created: CanvasNodeData[] = []
  for (let index = reuseIds.length; index < needed; index++) {
    const position = imageBatchSlotPosition(root, index)
    const child = createCanvasNode(CanvasNodeType.Image, position, {
      status: 'loading',
      batchRootId: root.id,
      prompt: root.metadata?.prompt,
      model: root.metadata?.model,
      size: root.metadata?.size,
      quality: root.metadata?.quality,
    })
    child.width = root.width
    child.height = root.height
    child.position = position
    child.parentId = root.parentId
    child.title = `${root.title} ${index + 2}`
    created.push(child)
  }
  return { reuseIds, created, removeIds: existing.slice(needed) }
}
