import { describe, expect, it } from 'vitest'

import { CanvasNodeType, type CanvasNodeData } from '../types'
import {
  settleInterruptedGenerations,
  shouldRecoverCanvasVideoTask,
} from './canvas-video-recovery'

const pendingNode = {
  id: 'video-1',
  type: CanvasNodeType.Video,
  metadata: { taskId: 'task-1', taskStatus: 'RUNNING' },
} as CanvasNodeData

describe('canvas video task recovery', () => {
  it('recovers persisted unfinished tasks but not terminal tasks', () => {
    expect(
      shouldRecoverCanvasVideoTask(pendingNode, new Set(), new Set())
    ).toBe(true)
    expect(
      shouldRecoverCanvasVideoTask(
        {
          ...pendingNode,
          metadata: { ...pendingNode.metadata, taskStatus: 'SUCCESS' },
        },
        new Set(),
        new Set()
      )
    ).toBe(false)
  })

  it('prevents duplicate observers and respects a local observation stop', () => {
    expect(
      shouldRecoverCanvasVideoTask(pendingNode, new Set(['video-1']), new Set())
    ).toBe(false)
    expect(
      shouldRecoverCanvasVideoTask(pendingNode, new Set(), new Set(['video-1']))
    ).toBe(false)
  })
})

describe('settleInterruptedGenerations', () => {
  it('clears stale spinners on unresumable nodes and leaves video tasks to the observer', () => {
    const nodes = [
      {
        id: 'img-empty',
        type: CanvasNodeType.Image,
        metadata: { status: 'loading' },
      },
      {
        id: 'img-done',
        type: CanvasNodeType.Image,
        metadata: { status: 'loading', content: '/a.png' },
      },
      {
        ...pendingNode,
        metadata: { ...pendingNode.metadata, status: 'loading' },
      },
    ] as CanvasNodeData[]
    expect(
      settleInterruptedGenerations(nodes).map((node) => node.metadata?.status)
    ).toEqual(['idle', 'success', 'loading'])
  })
})
