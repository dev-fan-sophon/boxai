import { CanvasNodeType, type CanvasNodeData } from '../types'

export function shouldRecoverCanvasVideoTask(
  node: CanvasNodeData,
  activeNodeIds: ReadonlySet<string>,
  stoppedNodeIds: ReadonlySet<string>
): boolean {
  const status = node.metadata?.taskStatus
  return Boolean(
    node.type === CanvasNodeType.Video &&
    node.metadata?.taskId &&
    (status !== 'SUCCESS' ||
      node.metadata?.status !== 'success' ||
      !node.metadata?.content) &&
    status !== 'FAILURE' &&
    !activeNodeIds.has(node.id) &&
    !stoppedNodeIds.has(node.id)
  )
}

/**
 * A saved document can hold nodes that were mid-request when the tab closed.
 * Image and audio requests cannot be resumed, so their spinner would never
 * clear and the node would refuse to generate again; settle them on load.
 * Video nodes with a task id are resumed by the task observer instead.
 */
export function settleInterruptedGenerations(
  nodes: CanvasNodeData[]
): CanvasNodeData[] {
  return nodes.map((node) => {
    if (node.metadata?.status !== 'loading') return node
    if (node.type === CanvasNodeType.Video && node.metadata.taskId) return node
    return {
      ...node,
      metadata: {
        ...node.metadata,
        status: node.metadata.content ? 'success' : 'idle',
      },
    }
  })
}
