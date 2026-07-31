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
    status !== 'SUCCESS' &&
    status !== 'FAILURE' &&
    !activeNodeIds.has(node.id) &&
    !stoppedNodeIds.has(node.id)
  )
}
