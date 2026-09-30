import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildCanvasVideoSubmitInput,
  runCanvasVideoGeneration,
} from '../engine/canvas-generation-runner'
import { shouldRecoverCanvasVideoTask } from '../engine/canvas-video-recovery'
import { useCanvasStore } from '../store/canvas-store'
import { CanvasNodeType, type CanvasNodeData } from '../types'
import {
  resolveGenerationSettings,
  useCanvasGeneration,
} from './use-canvas-generation'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/stores/playground-store', () => ({
  usePlaygroundStore: { getState: () => ({ config: { group: 'g' } }) },
}))
vi.mock('../components/nodes/node-shared', () => ({
  MISSING_MODEL_ERROR: 'Missing model',
}))
vi.mock('../engine/canvas-generation-runner', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../engine/canvas-generation-runner')
  >()),
  runCanvasVideoGeneration: vi.fn(),
}))
vi.mock('@/features/playground/api', () => ({}))
vi.mock('@/features/playground/lib/download-generated-media', () => ({}))
vi.mock('@/features/usage-logs/api', () => ({}))

const node: CanvasNodeData = {
  id: 'video',
  type: CanvasNodeType.Video,
  title: 'Video',
  position: { x: 0, y: 0 },
  width: 300,
  height: 200,
  metadata: {
    model: 'seedance-2-0',
    prompt: 'p',
    taskId: 'old',
    taskStatus: 'SUCCESS',
    status: 'success',
    content: '/old.mp4',
  },
}

function generationActions() {
  let actions!: ReturnType<typeof useCanvasGeneration>
  function Harness() {
    actions = useCanvasGeneration()
    return null
  }
  renderToString(createElement(Harness))
  return actions
}

beforeEach(() => {
  vi.clearAllMocks()
  useCanvasStore.setState({ nodes: [structuredClone(node)], connections: [] })
})

describe('canvas video settings and run ownership', () => {
  it('carries node overrides and preset defaults through to the video request, including false', () => {
    const preset = {
      ...node,
      id: 'preset',
      metadata: {
        aspectRatio: '9:16',
        resolution: '1080p',
        generateAudio: true,
        videoReferenceMode: 'references' as const,
      },
    }
    const settings = resolveGenerationSettings(
      { ...node, metadata: { ...node.metadata, generateAudio: false } },
      [preset],
      'preset'
    )
    expect(settings).toMatchObject({
      aspectRatio: '9:16',
      resolution: '1080p',
      generateAudio: false,
      videoReferenceMode: 'references',
    })
    expect(
      buildCanvasVideoSubmitInput({
        prompt: 'p',
        referenceImages: ['a', 'b'],
        settings,
      })
    ).toMatchObject({
      aspectRatio: '9:16',
      resolution: '1080p',
      generateAudio: false,
      referenceImages: ['a', 'b'],
    })
  })

  it('clears the old task before submit and saves a late accepted ID after cancellation', async () => {
    const actions = generationActions()
    let finish!: () => void
    vi.mocked(runCanvasVideoGeneration).mockImplementationOnce(
      async (input) => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        input.onProgress?.({
          taskId: 'accepted',
          status: 'SUBMITTED',
          percent: null,
        })
        throw new DOMException('Aborted', 'AbortError')
      }
    )
    const run = actions.generateNode('video')
    expect(useCanvasStore.getState().nodes[0].metadata?.taskId).toBeUndefined()
    expect(
      shouldRecoverCanvasVideoTask(
        useCanvasStore.getState().nodes[0],
        new Set(),
        new Set()
      )
    ).toBe(false)
    actions.cancelNode('video')
    finish()
    await run
    expect(useCanvasStore.getState().nodes[0].metadata).toMatchObject({
      taskId: 'accepted',
      taskStatus: 'OBSERVATION_STOPPED',
      status: 'idle',
    })
  })

  it('does not let an old finalizer or cleanup overwrite or stop a newer run', async () => {
    const actions = generationActions()
    let finishOld!: (
      value: Awaited<ReturnType<typeof runCanvasVideoGeneration>>
    ) => void
    let finishNew!: (
      value: Awaited<ReturnType<typeof runCanvasVideoGeneration>>
    ) => void
    vi.mocked(runCanvasVideoGeneration)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishNew = resolve
          })
      )
    const oldRun = actions.generateNode('video')
    actions.cancelNode('video')
    const newRun = actions.generateNode('video')
    finishOld({ url: '/stale.mp4', taskId: 'old' })
    await oldRun
    expect(useCanvasStore.getState().nodes[0].metadata).toMatchObject({
      status: 'loading',
      content: '/old.mp4',
    })
    actions.cancelNode('video')
    expect(useCanvasStore.getState().nodes[0].metadata?.taskStatus).toBe(
      'OBSERVATION_STOPPED'
    )
    finishNew({ url: '/cancelled.mp4', taskId: 'new' })
    await newRun
    expect(useCanvasStore.getState().nodes[0].metadata?.content).toBe(
      '/old.mp4'
    )
  })
})
