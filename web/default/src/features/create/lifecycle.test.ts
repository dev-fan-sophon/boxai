import { readFile } from 'node:fs/promises'
import path from 'node:path'

import JSZip from 'jszip'
import { chromium, type Browser, type Page, type Route } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import type { LifecycleFixture } from './lifecycle.fixture'

// Uses the already-declared Playwright dependency instead of adding a DOM
// emulator. Install its browser once with `bunx playwright install chromium`.
let server: ViteDevServer
let browser: Browser
let page: Page
let baseUrl: string

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    resolve: { alias: { '@': path.resolve('src') } },
    server: { port: 0, host: '127.0.0.1' },
    plugins: [
      {
        name: 'playground-lifecycle-fixture',
        configureServer(vite) {
          vite.middlewares.use('/lifecycle-fixture', (_req, res) => {
            res.setHeader('Content-Type', 'text/html')
            res.end(
              '<div id="root"></div><script type="module" src="/src/features/create/lifecycle.fixture.tsx"></script>'
            )
          })
        },
      },
    ],
  })
  await server.listen()
  const localUrl = server.resolvedUrls?.local[0]
  if (!localUrl) throw new Error('Fixture server did not start')
  baseUrl = localUrl
  browser = await chromium.launch({ headless: true })
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

beforeEach(async () => {
  page = await browser.newPage()
  // No production API access: every API request must be supplied by the test.
  await page.route('**/api/**', (route) =>
    route.fulfill({ json: { success: true, data: { items: [] } } })
  )
  await page.goto(`${baseUrl}lifecycle-fixture`)
  await page.waitForFunction(() => Boolean(window.renderLifecycleFixture))
})

afterEach(async () => {
  await page?.close()
})

async function render(state: LifecycleFixture) {
  await page.evaluate((value) => window.renderLifecycleFixture(value), state)
}

describe('restored video tasks and batch downloads', () => {
  it('finds old tasks beyond the first history page, polls missing/pending IDs independently, and gates ZIP entries by success', async () => {
    await page.clock.install()
    const requests: string[] = []
    let phase = 0
    await page.route('**/api/task/self?*', (route) => {
      const id =
        new URL(route.request().url()).searchParams.get('task_id') ?? ''
      requests.push(id)
      // Fifty unrelated completed tasks must never decide a requested task's state.
      let items: object[] = Array.from({ length: 50 }, (_, index) => ({
        task_id: `unrelated-${index}`,
        status: 'SUCCESS',
      }))
      if (id === 'old-pending') {
        items = [
          {
            task_id: id,
            status: phase ? 'SUCCESS' : 'IN_PROGRESS',
            progress: '40%',
          },
        ]
      }
      if (id === 'old-missing') {
        items = phase ? [{ task_id: id, status: 'SUCCESS' }] : []
      }
      if (id === 'old-failed') {
        items = [
          {
            task_id: id,
            status: 'FAILURE',
            fail_reason: 'Provider rejected this task',
          },
        ]
      }
      return route.fulfill({ json: { success: true, data: { items } } })
    })
    const downloaded: string[] = []
    await page.route('**/v1/videos/*/content*', (route) => {
      if (new URL(route.request().url()).searchParams.has('download')) {
        downloaded.push(route.request().url())
      }
      return route.fulfill({ contentType: 'video/mp4', body: 'video-bytes' })
    })
    await render({
      modality: 'video',
      runs: ['old-pending', 'old-missing', 'old-failed'].map(
        (taskId, index) => ({ id: index + 1, taskId, createdAt: 1 })
      ),
    })
    await page.getByRole('alert').waitFor()
    expect(await page.getByRole('alert').textContent()).toContain(
      'Provider rejected this task'
    )
    expect(await page.getByRole('status').count()).toBe(2)
    expect(await page.locator('video').count()).toBe(0)
    expect(
      await page.getByRole('button', { name: 'Download all as ZIP' }).count()
    ).toBe(0)
    expect(requests.sort()).toEqual([
      'old-failed',
      'old-missing',
      'old-pending',
    ])

    phase = 1
    await page.clock.fastForward(5000)
    await page.getByRole('button', { name: 'Download all as ZIP' }).waitFor()
    expect(await page.locator('video').count()).toBe(2)
    expect(requests.filter((id) => id === 'old-failed')).toHaveLength(1)
    expect(requests.filter((id) => id === 'old-missing')).toHaveLength(2)
    expect(requests.filter((id) => id === 'old-pending')).toHaveLength(2)
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download all as ZIP' }).click()
    const download = await downloadPromise
    const downloadPath = await download.path()
    if (!downloadPath) throw new Error('ZIP download did not complete')
    const zip = await JSZip.loadAsync(await readFile(downloadPath))
    expect(Object.keys(zip.files)).toEqual(['video-01.mp4', 'video-02.mp4'])
    expect(downloaded.map((url) => new URL(url).pathname).sort()).toEqual([
      '/v1/videos/old-missing/content',
      '/v1/videos/old-pending/content',
    ])
  })

  it.each(['image', 'audio'] as const)(
    'preserves completed %s batch downloads',
    async (modality) => {
      await page.route('**/media/*', (route) =>
        route.fulfill({
          contentType: modality === 'image' ? 'image/png' : 'audio/mpeg',
          body: 'media-bytes',
        })
      )
      await render({
        modality,
        runs: [
          { id: 1, resultUrl: '/media/1' },
          { id: 2, resultUrl: '/media/2' },
          { id: 3 },
        ],
      })
      const downloadPromise = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Download all as ZIP' }).click()
      const download = await downloadPromise
      const downloadPath = await download.path()
      if (!downloadPath) throw new Error('ZIP download did not complete')
      const zip = await JSZip.loadAsync(await readFile(downloadPath))
      const extension = modality === 'image' ? 'png' : 'mp3'
      expect(Object.keys(zip.files)).toEqual([
        `${modality}-01.${extension}`,
        `${modality}-02.${extension}`,
      ])
    }
  )
})

describe('phone reference upload lifecycle', () => {
  const newer = { id: 'newer', name: 'New selection', dataUrl: '/media/newer' }

  async function startPendingUpload() {
    await page.route('**/api/playground/upload-sessions', (route) =>
      route.fulfill({
        json: { success: true, data: { token: 'phone', upload_url: '/phone' } },
      })
    )
    let receiveRoute!: (route: Route) => void
    const pending = new Promise<Route>((resolve) => {
      receiveRoute = resolve
    })
    await page.route('**/api/playground/upload-sessions/phone', receiveRoute)
    await render({
      references: [{ id: 'old', name: 'Old selection', dataUrl: '/media/old' }],
      maxFiles: 3,
    })
    await page.getByRole('button', { name: 'Scan to upload' }).click()
    return pending
  }

  it('appends to the latest selection rather than restoring the selection captured at session creation', async () => {
    const route = await startPendingUpload()
    await render({ references: [newer], maxFiles: 2 })
    await route.fulfill({
      json: {
        success: true,
        data: { asset: { id: 9, name: 'Phone image', url: '/media/phone' } },
      },
    })
    await page.waitForFunction(() => window.referenceChanges.length === 1)
    expect(await page.evaluate(() => window.referenceChanges)).toEqual([
      [
        newer,
        {
          id: 'asset-9',
          name: 'Phone image',
          dataUrl: '/media/phone',
          assetId: 9,
        },
      ],
    ])
  })

  it.each(['limit', 'disabled', 'kind', 'unmount'] as const)(
    'ignores late results after %s changes',
    async (change) => {
      const route = await startPendingUpload()
      await render({
        references: [newer],
        maxFiles: change === 'limit' ? 1 : 3,
        attachable: change !== 'disabled',
        kind: change === 'kind' ? 'audio' : undefined,
        unmount: change === 'unmount',
      })
      const response = page.waitForResponse(
        '**/api/playground/upload-sessions/phone'
      )
      await route.fulfill({
        json: {
          success: true,
          data: { asset: { id: 9, name: 'Phone image', url: '/media/phone' } },
        },
      })
      await (await response).finished()
      // A browser turn after the response settles, not a time-based sleep.
      await page.evaluate(
        () => new Promise<void>((resolve) => setTimeout(resolve, 0))
      )
      expect(await page.evaluate(() => window.referenceChanges)).toEqual([])
    }
  )
})

describe('video capability lifecycle', () => {
  const profile = (overrides: Record<string, unknown> = {}) => ({
    family: 'generic',
    aspectRatios: ['16:9'],
    resolutions: ['720p'],
    imageOnlyResolutions: [],
    durations: [5],
    durationRange: { min: 5, max: 5 },
    defaults: { aspectRatio: '16:9', resolution: '720p', duration: 5 },
    maxReferenceImages: 1,
    supportsLastFrame: false,
    requiresImage: false,
    supportsAudioToggle: false,
    usesVolcengineMetadata: false,
    ...overrides,
  })

  it('explains the required image and enables generation after one is attached', async () => {
    await page.route('**/api/playground/video-capabilities?*', (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            frames: profile({ requiresImage: true, maxReferenceImages: 0 }),
          },
        },
      })
    )
    await render({ videoComposer: true, group: 'image-only' })
    await page.getByText('This model needs a reference image').waitFor()
    await page.getByRole('textbox').fill('A cat walking through a garden')
    expect(
      await page.locator('input[type=file][accept="image/*"]').count()
    ).toBe(1)
    expect(
      await page.getByRole('button', { name: 'Generate' }).isDisabled()
    ).toBe(true)
    await render({
      videoComposer: true,
      group: 'image-only',
      references: [{ id: 'one', name: 'one', dataUrl: '/media/one' }],
    })
    await expect
      .poll(() => page.getByRole('button', { name: 'Generate' }).isEnabled())
      .toBe(true)
    expect(
      await page.getByText('This model needs a reference image').count()
    ).toBe(0)
  })

  it('allows text-only generation with Seedance capabilities', async () => {
    await page.route('**/api/playground/video-capabilities?*', (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            text: profile({
              family: 'seedance-2.5',
              aspectRatios: [
                '16:9',
                '9:16',
                '1:1',
                '4:3',
                '3:4',
                '21:9',
                'adaptive',
              ],
              resolutions: ['480p', '720p', '1080p'],
              durations: [4, 5, 6, 8, 10, 12, 15, 20, 25, 30],
              durationRange: { min: 4, max: 30 },
              maxReferenceImages: 0,
              usesVolcengineMetadata: true,
            }),
          },
        },
      })
    )
    await render({ videoComposer: true, group: 'default' })
    await page.getByRole('textbox').fill('A cat walking through a garden')
    await expect
      .poll(() => page.getByRole('button', { name: 'Generate' }).isEnabled())
      .toBe(true)
    expect(
      await page
        .getByText('This video mode is unavailable for the selected model.')
        .count()
    ).toBe(0)
  })

  it('enables Grok 1.5 text-only generation and offers 1080p without an image', async () => {
    const grok = profile({
      family: 'xai',
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p'],
      resolutionAspectRatios: { '1080p': ['16:9'] },
      durations: [3, 5, 8, 10, 15],
      durationRange: { min: 1, max: 15 },
      maxReferenceImages: 0,
    })
    await page.route('**/api/playground/video-capabilities?*', (route) =>
      route.fulfill({
        json: { success: true, data: { text: grok, frames: grok } },
      })
    )
    await render({ videoComposer: true, group: 'default' })
    await page.getByRole('textbox').fill('A paper boat floating across a lake')
    await expect
      .poll(() => page.getByRole('button', { name: 'Generate' }).isEnabled())
      .toBe(true)
    expect(
      await page.getByText('This model needs a reference image').count()
    ).toBe(0)
    await page.getByRole('button', { name: 'Resolution', exact: true }).click()
    await page.getByText('1080p', { exact: true }).click()
    expect(
      await page.getByRole('button', { name: 'Generate' }).isEnabled()
    ).toBe(true)
  })

  it('locks frame ratio and unlocks the reference-mode ratio returned by the server', async () => {
    await page.route('**/api/playground/video-capabilities?*', (route) =>
      route.fulfill({
        json: {
          success: true,
          data: {
            text: profile(),
            frames: profile({
              aspectRatios: ['adaptive'],
              defaults: {
                aspectRatio: 'adaptive',
                resolution: '720p',
                duration: 5,
              },
            }),
            references: profile({ aspectRatios: ['16:9', '9:16'] }),
          },
        },
      })
    )
    await render({
      videoComposer: true,
      group: 'modes',
      references: [{ id: 'one', name: 'one', dataUrl: '/media/one' }],
    })
    await page.getByRole('radio', { name: 'Frames' }).waitFor()
    await page.getByRole('radio', { name: 'References' }).click()
    await page.getByRole('button', { name: 'Aspect ratio' }).click()
    expect(await page.getByText('9:16').count()).toBeGreaterThan(0)
  })
})

describe('image capability lifecycle', () => {
  const imageProfile = (overrides: Record<string, unknown>) => ({
    family: 'xai',
    modes: ['generate', 'edit'],
    maxReferenceImages: 5,
    sizeMode: 'aspect',
    sizes: [],
    aspectRatios: ['auto', '1:1', '16:9', '9:16'],
    resolutions: ['1k', '2k'],
    qualities: ['auto', 'low', 'medium'],
    maxN: 10,
    supportsMask: false,
    backgrounds: [],
    outputFormats: [],
    moderation: [],
    defaults: { aspectRatio: 'auto', resolution: '1k', quality: 'auto' },
    ...overrides,
  })
  const references = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `ref-${index}`,
      name: `ref-${index}`,
      dataUrl: `/media/ref-${index}`,
    }))

  it('shows Grok aspect and resolution controls with a 5-image counter', async () => {
    await page.route('**/api/playground/image-capabilities?*', (route) =>
      route.fulfill({ json: { success: true, data: imageProfile({}) } })
    )
    await render({
      imageComposerModel: 'grok-imagine-image-2.0',
      group: 'grok',
      references: references(3),
    })
    await page.getByText('3/5').waitFor()
    await page.getByRole('button', { name: 'Resolution' }).waitFor()
    expect(await page.getByRole('button', { name: 'Image size' }).count()).toBe(
      0
    )
    expect(await page.getByRole('button', { name: 'Paint mask' }).count()).toBe(
      0
    )
  })

  it('accepts 14 Gemini references and blocks a fifteenth', async () => {
    await page.route('**/api/playground/image-capabilities?*', (route) =>
      route.fulfill({
        json: {
          success: true,
          data: imageProfile({
            family: 'gemini',
            maxReferenceImages: 14,
            aspectRatios: ['1:1', '16:9', '21:9'],
            resolutions: ['1K'],
            qualities: [],
            maxN: 1,
            defaults: { aspectRatio: '1:1', resolution: '1K' },
          }),
        },
      })
    )
    await render({
      imageComposerModel: 'gemini-3.1-flash-lite-image',
      group: 'gemini',
      references: references(14),
    })
    await page.getByText('14/14').waitFor()
    await page.getByRole('textbox').fill('Blend these products')
    await expect
      .poll(() => page.getByRole('button', { name: 'Generate' }).isEnabled())
      .toBe(true)
    expect(
      await page.getByRole('button', { name: 'Image quality' }).count()
    ).toBe(0)

    await render({
      imageComposerModel: 'gemini-3.1-flash-lite-image',
      group: 'gemini',
      references: references(15),
    })
    await page
      .getByText('Remove extra reference images before generating.')
      .waitFor()
    expect(
      await page.getByRole('button', { name: 'Generate' }).isDisabled()
    ).toBe(true)
  })

  it('offers transparency, output format and the mask editor for GPT Image', async () => {
    await page.route('**/api/playground/image-capabilities?*', (route) =>
      route.fulfill({
        json: {
          success: true,
          data: imageProfile({
            family: 'gpt-image',
            maxReferenceImages: 16,
            sizeMode: 'pixels',
            sizes: ['auto', '1024x1024', '3840x2160'],
            aspectRatios: [],
            resolutions: [],
            qualities: ['auto', 'low', 'medium', 'high'],
            maxN: 1,
            supportsMask: true,
            backgrounds: ['auto', 'opaque', 'transparent'],
            outputFormats: ['png', 'jpeg', 'webp'],
            moderation: ['auto', 'low'],
            defaults: {
              size: '1024x1024',
              quality: 'auto',
              background: 'auto',
              outputFormat: 'png',
            },
          }),
        },
      })
    )
    await render({
      imageComposerModel: 'gpt-image-2',
      group: 'gpt',
      references: references(1),
    })
    await page.getByText('1/16').waitFor()
    await page.getByRole('button', { name: 'Transparent' }).waitFor()
    await page.getByRole('button', { name: 'Output format' }).waitFor()
    await page.getByRole('button', { name: 'Paint mask' }).click()
    await page.getByRole('dialog').getByText('Edit mask').waitFor()
  })
})
