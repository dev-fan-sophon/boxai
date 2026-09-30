import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'

import { uploadPlaygroundAsset } from '@/features/playground/api'

import { useCanvasStore } from '../store/canvas-store'
import { CanvasNodeType } from '../types'
import { useCanvasMediaImport } from './use-canvas-media-import'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/features/playground/api', () => ({ uploadPlaygroundAsset: vi.fn() }))

afterEach(() => vi.unstubAllGlobals())

it('places measured reference images outside the target and below existing inputs', async () => {
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 600
      naturalHeight = 480
      onLoad?: () => void
      addEventListener(event: string, callback: () => void) {
        if (event === 'load') this.onLoad = callback
      }
      set src(_url: string) {
        this.onLoad?.()
      }
    }
  )
  vi.mocked(uploadPlaygroundAsset).mockResolvedValue({
    id: 12,
    url: '/reference.png',
  } as Awaited<ReturnType<typeof uploadPlaygroundAsset>>)
  useCanvasStore.setState({ nodes: [], connections: [] })
  const target = useCanvasStore
    .getState()
    .addNode(CanvasNodeType.Video, { x: 1000, y: 500 })
  useCanvasStore
    .getState()
    .updateNode(target.id, { position: { x: 1000, y: 500 } })
  let actions!: ReturnType<typeof useCanvasMediaImport>
  function Harness() {
    actions = useCanvasMediaImport()
    return null
  }
  renderToString(createElement(Harness))
  const file = new File(['image'], 'reference.png', { type: 'image/png' })
  await actions.attachReferenceImages(target.id, [file])
  await actions.attachReferenceImages(target.id, [file])
  const references = useCanvasStore
    .getState()
    .nodes.filter((node) => node.id !== target.id)
  expect(
    references.map((node) => ({
      position: node.position,
      width: node.width,
      height: node.height,
    }))
  ).toEqual([
    { position: { x: 368, y: 500 }, width: 600, height: 480 },
    { position: { x: 368, y: 1012 }, width: 600, height: 480 },
  ])
  expect(
    useCanvasStore
      .getState()
      .connections.map((connection) => connection.toNodeId)
  ).toEqual([target.id, target.id])
})
