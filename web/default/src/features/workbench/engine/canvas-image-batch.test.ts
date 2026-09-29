import { describe, expect, it } from 'vitest'

import { CanvasNodeType, type CanvasNodeData } from '../types'
import {
  IMAGE_BATCH_COLUMNS,
  imageBatchSlotPosition,
  planImageBatchSlots,
} from './canvas-image-batch'

const imageNode = (
  id: string,
  metadata: CanvasNodeData['metadata'] = {}
): CanvasNodeData => ({
  id,
  title: 'Shot',
  type: CanvasNodeType.Image,
  position: { x: 0, y: 0 },
  width: 300,
  height: 320,
  parentId: 'frame-1',
  metadata,
})

describe('imageBatchSlotPosition', () => {
  it('fills rows of five to the right of the root', () => {
    const root = imageNode('root')
    expect(imageBatchSlotPosition(root, 0)).toEqual({ x: 324, y: 0 })
    expect(imageBatchSlotPosition(root, IMAGE_BATCH_COLUMNS - 1)).toEqual({
      x: 324 * 5,
      y: 0,
    })
    expect(imageBatchSlotPosition(root, IMAGE_BATCH_COLUMNS)).toEqual({
      x: 324,
      y: 344,
    })
  })
})

describe('planImageBatchSlots', () => {
  it('creates loading children for a fresh batch, copying the root settings', () => {
    const root = imageNode('root', {
      prompt: 'a lantern',
      model: 'gpt-image-2',
      size: '1024x1536',
    })
    const plan = planImageBatchSlots(root, [root], 4)
    expect(plan.reuseIds).toEqual([])
    expect(plan.removeIds).toEqual([])
    expect(plan.created).toHaveLength(3)
    expect(plan.created[2]).toMatchObject({
      parentId: 'frame-1',
      title: 'Shot 4',
      width: 300,
      height: 320,
      position: { x: 324 * 3, y: 0 },
      metadata: {
        status: 'loading',
        batchRootId: 'root',
        prompt: 'a lantern',
        size: '1024x1536',
      },
    })
  })

  it('reuses surviving children and drops the ones beyond the new count', () => {
    const root = imageNode('root', {
      batchChildIds: ['c1', 'gone', 'c2', 'c3'],
    })
    const nodes = [root, imageNode('c1'), imageNode('c2'), imageNode('c3')]
    const plan = planImageBatchSlots(root, nodes, 3)
    expect(plan.reuseIds).toEqual(['c1', 'c2'])
    expect(plan.removeIds).toEqual(['c3'])
    expect(plan.created).toEqual([])
  })

  it('grows a smaller previous batch', () => {
    const root = imageNode('root', { batchChildIds: ['c1'] })
    const plan = planImageBatchSlots(root, [root, imageNode('c1')], 3)
    expect(plan.reuseIds).toEqual(['c1'])
    expect(plan.created.map((node) => node.position)).toEqual([
      { x: 324 * 2, y: 0 },
    ])
  })
})
