import {
  CanvasNodeType,
  type CanvasDocument,
  type CanvasNodeData,
} from '../types'
import { createCanvasNode } from './canvas-domain'
import { IMAGE_BATCH_COLUMNS, IMAGE_BATCH_GAP } from './canvas-image-batch'
import {
  fitNodeSize,
  getCanvasNodesBounds,
  viewportForBounds,
  type CanvasViewportSize,
} from './canvas-viewport'

/** A finished image brought onto a new canvas from outside the workbench. */
export type CanvasImageSource = {
  /** Persisted URL: a playground asset content route or an http(s) URL. */
  url: string
  assetId?: number
  prompt?: string
  model?: string
  naturalWidth?: number
  naturalHeight?: number
}

const NODE_TITLE_MAX = 48

/**
 * Builds a canvas document with one finished image node per source, laid out
 * row by row in the same five-column grid and gap as an expanded image batch.
 * Nodes are sized like canvas generations (natural ratio, fitted) and the
 * viewport frames the whole grid, so the canvas opens with every image in view.
 */
export function canvasDocumentFromImages(
  sources: CanvasImageSource[],
  options: { viewportSize: CanvasViewportSize; fallbackTitle: string }
): CanvasDocument {
  const nodes: CanvasNodeData[] = sources.map((source) => {
    const prompt = source.prompt?.trim() || undefined
    const node = createCanvasNode(
      CanvasNodeType.Image,
      { x: 0, y: 0 },
      {
        content: source.url,
        assetId: source.assetId,
        prompt,
        model: source.model,
        naturalWidth: source.naturalWidth,
        naturalHeight: source.naturalHeight,
        status: 'success',
      }
    )
    if (source.naturalWidth && source.naturalHeight) {
      const size = fitNodeSize(source.naturalWidth, source.naturalHeight)
      node.width = size.width
      node.height = size.height
    }
    let title = prompt ?? options.fallbackTitle
    if (title.length > NODE_TITLE_MAX) {
      title = `${title.slice(0, NODE_TITLE_MAX - 1).trimEnd()}…`
    }
    node.title = title
    return node
  })

  // Uniform columns keep the grid aligned; each row is as tall as its
  // tallest image so portrait and landscape results never overlap.
  const columnWidth = Math.max(0, ...nodes.map((node) => node.width))
  let rowTop = 0
  for (let start = 0; start < nodes.length; start += IMAGE_BATCH_COLUMNS) {
    const row = nodes.slice(start, start + IMAGE_BATCH_COLUMNS)
    row.forEach((node, column) => {
      node.position = {
        x: (columnWidth + IMAGE_BATCH_GAP) * column,
        y: rowTop,
      }
    })
    rowTop += Math.max(...row.map((node) => node.height)) + IMAGE_BATCH_GAP
  }

  const bounds = getCanvasNodesBounds(nodes)
  return {
    nodes,
    connections: [],
    viewport: bounds
      ? viewportForBounds(bounds, options.viewportSize)
      : { x: 0, y: 0, k: 1 },
    backgroundMode: 'lines',
    experienceMode: 'professional',
  }
}
