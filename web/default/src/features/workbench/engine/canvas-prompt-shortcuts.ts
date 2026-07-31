import type { CanvasGenerationMode, CanvasNodeData } from '../types'

export const CANVAS_PROMPT_PRESETS: Array<{
  id: string
  labelKey: string
  text: string
  modalities: CanvasGenerationMode[]
}> = [
  {
    id: 'cinematic',
    labelKey: 'Cinematic',
    text: 'cinematic lighting, strong composition',
    modalities: ['image', 'video'],
  },
  {
    id: 'product',
    labelKey: 'Product shot',
    text: 'clean product photography, studio lighting',
    modalities: ['image'],
  },
  {
    id: 'motion',
    labelKey: 'Smooth motion',
    text: 'smooth natural motion, stable camera movement',
    modalities: ['video'],
  },
  {
    id: 'narration',
    labelKey: 'Natural narration',
    text: 'Warm, natural narration with clear pacing.',
    modalities: ['audio'],
  },
]

export function canvasMentionToken(node: CanvasNodeData): string {
  return `@[${node.title.replaceAll(']', '')}](node:${node.id})`
}

export function insertPromptShortcut(
  value: string,
  end: number,
  triggerStart: number,
  insertion: string
): { value: string; cursor: number } {
  const prefix = value.slice(0, triggerStart)
  const suffix = value.slice(end).trimStart()
  const spacer = prefix && !/\s$/.test(prefix) ? ' ' : ''
  const next = `${prefix}${spacer}${insertion} ${suffix}`
  return {
    value: next,
    cursor: prefix.length + spacer.length + insertion.length + 1,
  }
}

export function mentionedNodeIds(prompt: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const match of prompt.matchAll(/@\[[^\]]*\]\(node:([^\s)]+)\)/g)) {
    const id = match[1]
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}
