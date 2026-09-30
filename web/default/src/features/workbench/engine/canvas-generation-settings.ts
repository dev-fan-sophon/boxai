import { usePlaygroundStore } from '@/stores/playground-store'

import type { CanvasNodeData, CanvasNodeMetadata } from '../types'
import type { CanvasGenerationSettings } from './canvas-generation-runner'

function pickDefinedMetadata(
  source: CanvasNodeMetadata | undefined,
  keys: Array<keyof CanvasNodeMetadata>
): Partial<CanvasNodeMetadata> {
  const result: Partial<CanvasNodeMetadata> = {}
  if (!source) return result
  keys.forEach((key) => {
    const value = source[key]
    if (value !== undefined && value !== null && value !== '') {
      ;(result as Record<string, unknown>)[key] = value
    }
  })
  return result
}

export function resolveGenerationSettings(
  node: CanvasNodeData,
  nodes: CanvasNodeData[],
  presetNodeId?: string
): CanvasGenerationSettings {
  const preset = presetNodeId
    ? nodes.find((item) => item.id === presetNodeId)
    : undefined
  const keys: Array<keyof CanvasNodeMetadata> = [
    'model',
    'size',
    'quality',
    'count',
    'seconds',
    'aspectRatio',
    'resolution',
    'generateAudio',
    'videoReferenceMode',
    'audioVoice',
    'audioFormat',
    'audioSpeed',
    'audioInstructions',
  ]
  const merged = {
    ...pickDefinedMetadata(preset?.metadata, keys),
    ...pickDefinedMetadata(node.metadata, keys),
  }
  const group = usePlaygroundStore.getState().config.group || ''
  return {
    model: typeof merged.model === 'string' ? merged.model : '',
    group,
    size: typeof merged.size === 'string' ? merged.size : undefined,
    quality: typeof merged.quality === 'string' ? merged.quality : undefined,
    count: typeof merged.count === 'number' ? merged.count : undefined,
    seconds: typeof merged.seconds === 'string' ? merged.seconds : undefined,
    aspectRatio: merged.aspectRatio,
    resolution: merged.resolution,
    generateAudio: merged.generateAudio,
    videoReferenceMode: merged.videoReferenceMode,
    audioVoice:
      typeof merged.audioVoice === 'string' ? merged.audioVoice : undefined,
    audioFormat:
      typeof merged.audioFormat === 'string' ? merged.audioFormat : undefined,
    audioSpeed:
      typeof merged.audioSpeed === 'string' ? merged.audioSpeed : undefined,
    audioInstructions:
      typeof merged.audioInstructions === 'string'
        ? merged.audioInstructions
        : undefined,
  }
}
