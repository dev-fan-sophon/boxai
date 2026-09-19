import { describe, expect, it } from 'vitest'

import {
  CanvasNodeType,
  type CanvasConnection,
  type CanvasNodeData,
} from '../types'
import { createVideoBatchSiblings, planVideoBatch } from './canvas-video-batch'

const videoNode = (metadata: CanvasNodeData['metadata']): CanvasNodeData => ({
  id: 'video-root',
  title: 'Video',
  type: CanvasNodeType.Video,
  position: { x: 100, y: 50 },
  width: 400,
  height: 500,
  metadata,
})

describe('planVideoBatch', () => {
  it('runs the single prompt once when batch mode is off, regardless of batch text', () => {
    expect(
      planVideoBatch(videoNode({ prompt: 'one', videoBatchPrompts: 'a\nb\nc' }))
    ).toEqual({ prompts: ['one'], truncated: 0 })
  })

  it('repeats each line by count and caps the total at ten', () => {
    const lines = Array.from({ length: 6 }, (_, i) => `p${i + 1}`).join('\n')
    const plan = planVideoBatch(
      videoNode({ videoBatchMode: true, videoBatchPrompts: lines, count: 2 })
    )
    expect(plan.prompts).toEqual([
      'p1',
      'p1',
      'p2',
      'p2',
      'p3',
      'p3',
      'p4',
      'p4',
      'p5',
      'p5',
    ])
    expect(plan.truncated).toBe(2)
  })

  it('treats an empty batch box as a single empty prompt', () => {
    expect(
      planVideoBatch(
        videoNode({ videoBatchMode: true, videoBatchPrompts: '\n' })
      )
    ).toEqual({ prompts: [''], truncated: 0 })
  })
})

describe('createVideoBatchSiblings', () => {
  it('creates one sibling per extra prompt, copies settings and rewires inputs', () => {
    const root = videoNode({
      model: 'seedance-2-0',
      aspectRatio: '9:16',
      resolution: '1080p',
      seconds: '8',
      generateAudio: false,
      videoReferenceMode: 'references',
      prompt: 'first',
    })
    const connections: CanvasConnection[] = [
      { id: 'c1', fromNodeId: 'img-1', toNodeId: 'video-root' },
      { id: 'c2', fromNodeId: 'video-root', toNodeId: 'downstream' },
    ]
    const batch = createVideoBatchSiblings(
      root,
      ['first', 'second', 'third', 'fourth', 'fifth'],
      connections
    )

    expect(batch.nodes).toHaveLength(4)
    expect(batch.nodes.map((node) => node.metadata?.prompt)).toEqual([
      'second',
      'third',
      'fourth',
      'fifth',
    ])
    expect(batch.nodes[0].metadata).toMatchObject({
      model: 'seedance-2-0',
      aspectRatio: '9:16',
      resolution: '1080p',
      seconds: '8',
      generateAudio: false,
      videoReferenceMode: 'references',
      batchRootId: 'video-root',
    })
    expect(batch.nodes[0].metadata?.videoBatchMode).toBeUndefined()

    // 3-column grid: fourth prompt wraps to the second row under the first sibling.
    expect(batch.nodes[0].position).toEqual({ x: 532, y: 50 })
    expect(batch.nodes[2].position).toEqual({ x: 1396, y: 50 })
    expect(batch.nodes[3].position).toEqual({ x: 532, y: 582 })
    expect(batch.nodes.map((node) => node.title)).toEqual([
      'Video 2',
      'Video 3',
      'Video 4',
      'Video 5',
    ])

    // Only incoming connections are duplicated, once per sibling.
    expect(batch.connections).toHaveLength(4)
    expect(
      batch.connections.every(
        (connection) =>
          connection.fromNodeId === 'img-1' &&
          connection.id !== 'c1' &&
          batch.nodes.some((node) => node.id === connection.toNodeId)
      )
    ).toBe(true)
    expect(new Set(batch.connections.map((c) => c.id)).size).toBe(4)
  })
})
