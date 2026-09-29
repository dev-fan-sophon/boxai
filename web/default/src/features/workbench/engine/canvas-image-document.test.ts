import { describe, expect, it } from 'vitest'

import { CanvasNodeType } from '../types'
import { canvasDocumentFromImages } from './canvas-image-document'

const viewportSize = { width: 1600, height: 900 }

const square = (index: number) => ({
  url: `/api/playground/assets/${index}/content`,
  assetId: index,
  prompt: `shot ${index}`,
  model: 'gpt-image-2',
  naturalWidth: 1024,
  naturalHeight: 1024,
})

describe('canvasDocumentFromImages', () => {
  it('creates one finished image node per source with its generation metadata', () => {
    const doc = canvasDocumentFromImages([square(7)], {
      viewportSize,
      fallbackTitle: 'Image',
    })

    expect(doc.connections).toEqual([])
    expect(doc.nodes).toHaveLength(1)
    const [node] = doc.nodes
    expect(node.type).toBe(CanvasNodeType.Image)
    expect(node.title).toBe('shot 7')
    expect(node.metadata).toMatchObject({
      content: '/api/playground/assets/7/content',
      assetId: 7,
      prompt: 'shot 7',
      model: 'gpt-image-2',
      naturalWidth: 1024,
      naturalHeight: 1024,
      status: 'success',
    })
    // Sized like a canvas generation: natural ratio fitted into 640px.
    expect({ width: node.width, height: node.height }).toEqual({
      width: 640,
      height: 640,
    })
  })

  it('lays results out in rows of five using the image batch gap', () => {
    const doc = canvasDocumentFromImages(
      Array.from({ length: 7 }, (_, index) => square(index + 1)),
      { viewportSize, fallbackTitle: 'Image' }
    )

    expect(doc.nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: 664, y: 0 },
      { x: 1328, y: 0 },
      { x: 1992, y: 0 },
      { x: 2656, y: 0 },
      { x: 0, y: 664 },
      { x: 664, y: 664 },
    ])
  })

  it('makes each row as tall as its tallest image so mixed ratios never overlap', () => {
    const doc = canvasDocumentFromImages(
      [
        {
          url: 'https://cdn.example/a.png',
          naturalWidth: 1536,
          naturalHeight: 1024,
        },
        {
          url: 'https://cdn.example/b.png',
          naturalWidth: 1024,
          naturalHeight: 1536,
        },
        ...Array.from({ length: 4 }, (_, index) => square(index + 1)),
      ],
      { viewportSize, fallbackTitle: 'Image' }
    )

    const landscape = doc.nodes[0]
    expect(landscape.width).toBe(640)
    expect(landscape.height).toBeCloseTo(426.67, 1)
    // Row 1 holds the 640px-tall portrait, so row 2 starts below it.
    expect(doc.nodes[5].position).toEqual({ x: 0, y: 664 })
  })

  it('falls back to the default node size and title when the source is bare', () => {
    const doc = canvasDocumentFromImages(
      [{ url: 'https://cdn.example/a.png', prompt: '   ' }],
      { viewportSize, fallbackTitle: 'Studio image' }
    )

    const [node] = doc.nodes
    expect(node.title).toBe('Studio image')
    expect(node.metadata?.prompt).toBeUndefined()
    expect({ width: node.width, height: node.height }).toEqual({
      width: 360,
      height: 400,
    })
  })

  it('clips long prompts in node titles but keeps the full prompt', () => {
    const prompt = 'a very long prompt '.repeat(6).trim()
    const doc = canvasDocumentFromImages(
      [{ url: 'https://x.test/a.png', prompt }],
      {
        viewportSize,
        fallbackTitle: 'Image',
      }
    )

    expect(doc.nodes[0].title).toHaveLength(48)
    expect(doc.nodes[0].title.endsWith('…')).toBe(true)
    expect(doc.nodes[0].metadata?.prompt).toBe(prompt)
  })

  it('opens with the viewport framing the whole grid', () => {
    const doc = canvasDocumentFromImages(
      Array.from({ length: 10 }, (_, index) => square(index + 1)),
      { viewportSize, fallbackTitle: 'Image' }
    )

    // Grid spans 3296×1304 world px; the viewport scales it into view.
    const { x, y, k } = doc.viewport
    expect(k).toBeLessThan(1)
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x + 3296 * k).toBeLessThanOrEqual(viewportSize.width)
    expect(y + 1304 * k).toBeLessThanOrEqual(viewportSize.height)
  })
})
