/**
 * Encodes an assistant turn's AI SDK parts into the stored tool_json contract
 * shared with the web frontend and the desktop app:
 *   { managedTool?, sources?, reasoning? }
 * History reload and cross-device sync decode this shape, so it must stay
 * byte-compatible with what the browser used to write.
 *
 * The legacy shape carries one tool card per message; when an agent turn ran
 * several tools, the last one becomes the card and search sources from every
 * step are merged.
 */

type UIPart = {
  type: string
  text?: string
  state?: string
  errorText?: string
  output?: unknown
}

type LegacySource = {
  href: string
  title: string
  snippet?: string
  domain?: string
}

type LegacyCard = {
  action:
    | 'web_search'
    | 'generate_image'
    | 'generate_video'
    | 'generate_document'
  status: 'completed' | 'failed'
  model?: string
  taskId?: string
  images?: string[]
  videoUrl?: string
  error?: string
  documents?: Array<{
    assetId: number
    name: string
    url?: string
    mime: string
    size: number
    verified: boolean
  }>
  documentAttempts?: number
}

const TOOL_ACTIONS = new Set([
  'web_search',
  'generate_image',
  'generate_video',
  'generate_document',
])

function cardFromPart(part: UIPart): LegacyCard | null {
  const action = part.type.slice('tool-'.length) as LegacyCard['action']
  if (!TOOL_ACTIONS.has(action)) {
    return null
  }
  if (part.state === 'output-error') {
    return { action, status: 'failed', error: part.errorText || 'tool failed' }
  }
  if (part.state !== 'output-available') {
    return null
  }
  const output = (part.output ?? {}) as Record<string, unknown>
  switch (action) {
    case 'web_search':
      return { action, status: 'completed' }
    case 'generate_image': {
      const images = Array.isArray(output.images)
        ? (output.images as Array<{ url?: string }>)
            .map((image) => image.url ?? '')
            .filter(Boolean)
        : []
      return {
        action,
        status: 'completed',
        model: typeof output.model === 'string' ? output.model : undefined,
        images,
      }
    }
    case 'generate_video':
      return {
        action,
        status: 'completed',
        model: typeof output.model === 'string' ? output.model : undefined,
        taskId: typeof output.task_id === 'string' ? output.task_id : undefined,
        videoUrl:
          typeof output.video_url === 'string' ? output.video_url : undefined,
      }
    case 'generate_document': {
      const unverified = new Set(
        Array.isArray(output.unverified) ? (output.unverified as string[]) : []
      )
      const documents = Array.isArray(output.documents)
        ? (
            output.documents as Array<{
              asset_id?: number
              name?: string
              url?: string
              mime?: string
              size?: number
            }>
          ).map((doc) => ({
            assetId: doc.asset_id ?? 0,
            name: doc.name ?? '',
            url: doc.url,
            mime: doc.mime ?? '',
            size: doc.size ?? 0,
            verified: !unverified.has(doc.name ?? ''),
          }))
        : []
      return {
        action,
        status: 'completed',
        documents,
        documentAttempts:
          typeof output.attempts === 'number' ? output.attempts : undefined,
      }
    }
  }
}

export function encodeLegacyToolJson(parts: unknown[]): string {
  let managedTool: LegacyCard | undefined
  const sources: LegacySource[] = []
  const sourceHrefs = new Set<string>()
  let reasoning = ''

  for (const raw of parts) {
    const part = raw as UIPart
    if (part.type === 'reasoning' && part.text) {
      reasoning += (reasoning ? '\n' : '') + part.text
      continue
    }
    if (!part.type.startsWith('tool-')) {
      continue
    }
    const card = cardFromPart(part)
    if (!card) {
      continue
    }
    managedTool = card
    if (card.action === 'web_search' && part.state === 'output-available') {
      const output = (part.output ?? {}) as {
        sources?: Array<{ href?: string; title?: string; domain?: string }>
      }
      for (const source of output.sources ?? []) {
        if (source.href && !sourceHrefs.has(source.href)) {
          sourceHrefs.add(source.href)
          sources.push({
            href: source.href,
            title: source.title ?? source.href,
            domain: source.domain,
          })
        }
      }
    }
  }

  if (!managedTool && sources.length === 0 && !reasoning) {
    return ''
  }
  const payload: Record<string, unknown> = {}
  if (managedTool) {
    payload.managedTool = managedTool
  }
  if (sources.length > 0) {
    payload.sources = sources
  }
  if (reasoning) {
    payload.reasoning = { content: reasoning }
  }
  return JSON.stringify(payload)
}
