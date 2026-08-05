#!/usr/bin/env node
/**
 * Capture product docs screenshots:
 * - Live public pages from BASE_URL (default https://you-box.com)
 * - Local sanitized console fixtures (no real secrets)
 * Writes WebP at 480 / 960 / 1536 under public/docs/screenshots/
 *
 * Usage:
 *   node scripts/docs/screenshots/capture.mjs
 *   DOCS_SHOTS_BASE_URL=https://you-box.com node scripts/docs/screenshots/capture.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from 'playwright'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, '../../..')
const outRoot = path.join(webRoot, 'public/docs/screenshots')
const fixturesDir = path.join(__dirname, 'fixtures')

const BASE_URL = (process.env.DOCS_SHOTS_BASE_URL || 'https://you-box.com').replace(
  /\/$/,
  ''
)
const WIDTHS = [480, 960, 1536]
const VIEWPORT = { width: 1440, height: 900 }
const LOCALE = 'en'

/** @type {Array<{ id: string, area: string, name: string, kind: 'live'|'fixture', url?: string, fixture?: string, waitMs?: number, selector?: string, fullPage?: boolean }>} */
const SHOTS = [
  {
    id: 'auth-sign-in',
    area: 'auth',
    name: 'sign-in',
    kind: 'live',
    url: `${BASE_URL}/sign-in`,
    waitMs: 2500,
  },
  {
    id: 'console-model-hub',
    area: 'console',
    name: 'model-hub',
    kind: 'live',
    url: `${BASE_URL}/pricing`,
    waitMs: 3500,
  },
  {
    id: 'console-model-hub-detail',
    area: 'console',
    name: 'model-hub-detail',
    kind: 'fixture',
    fixture: 'model-hub-detail.html',
  },
  {
    id: 'console-api-keys-empty',
    area: 'console',
    name: 'api-keys-empty',
    kind: 'fixture',
    fixture: 'api-keys-empty.html',
  },
  {
    id: 'console-api-keys-create',
    area: 'console',
    name: 'api-keys-create',
    kind: 'fixture',
    fixture: 'api-keys-create.html',
  },
  {
    id: 'console-api-keys-created',
    area: 'console',
    name: 'api-keys-created',
    kind: 'fixture',
    fixture: 'api-keys-created.html',
  },
  {
    id: 'console-billing-topup',
    area: 'console',
    name: 'billing-topup',
    kind: 'fixture',
    fixture: 'billing-topup.html',
  },
  {
    id: 'console-usage-logs',
    area: 'console',
    name: 'usage-logs',
    kind: 'fixture',
    fixture: 'usage-logs.html',
  },
  {
    id: 'playground-chat',
    area: 'playground',
    name: 'chat-success',
    kind: 'fixture',
    fixture: 'playground-chat.html',
  },
  {
    id: 'start-docs-home',
    area: 'start',
    name: 'docs-home',
    kind: 'live',
    url: `${BASE_URL}/docs/start/what-is-boxai`,
    waitMs: 2500,
  },
  {
    id: 'start-getting-started',
    area: 'start',
    name: 'getting-started',
    kind: 'live',
    url: `${BASE_URL}/docs/start/getting-started`,
    waitMs: 2500,
  },
  {
    id: 'clients-downloads',
    area: 'clients',
    name: 'downloads',
    kind: 'live',
    url: `${BASE_URL}/downloads`,
    waitMs: 3000,
  },
]

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function writeWebpVariants(pngBuffer, area, baseName) {
  const dir = path.join(outRoot, area)
  await ensureDir(dir)
  const primary = path.join(dir, `${baseName}.${LOCALE}.webp`)
  await sharp(pngBuffer).webp({ quality: 82 }).toFile(primary)

  for (const width of WIDTHS) {
    const target = path.join(dir, `${baseName}.${LOCALE}-${width}.webp`)
    await sharp(pngBuffer)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: width <= 480 ? 78 : 82 })
      .toFile(target)
  }
  return primary
}

async function captureShot(browser, shot) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-US',
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  try {
    if (shot.kind === 'live') {
      const response = await page.goto(shot.url, {
        waitUntil: 'load',
        timeout: 90000,
      })
      if (response && response.status() >= 400) {
        throw new Error(`HTTP ${response.status()} for ${shot.url}`)
      }
      await page.waitForTimeout(shot.waitMs ?? 1500)
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.style.colorScheme = 'light'
      })
      await page.waitForTimeout(200)
    } else {
      const filePath = path.join(fixturesDir, shot.fixture)
      await page.goto(pathToFileURL(filePath).href, {
        waitUntil: 'load',
        timeout: 30000,
      })
      await page.waitForTimeout(150)
    }

    if (shot.selector) {
      const loc = page.locator(shot.selector).first()
      await loc.waitFor({ state: 'visible', timeout: 15000 })
      return await loc.screenshot({ type: 'png' })
    }

    return await page.screenshot({
      type: 'png',
      fullPage: Boolean(shot.fullPage),
      animations: 'disabled',
    })
  } finally {
    await context.close().catch(() => {})
  }
}

async function main() {
  await ensureDir(outRoot)
  const browser = await chromium.launch({ headless: true })

  const results = []
  for (const shot of SHOTS) {
    process.stdout.write(`[docs:screenshots] ${shot.id} … `)
    try {
      const png = await captureShot(browser, shot)
      const out = await writeWebpVariants(png, shot.area, shot.name)
      results.push({ id: shot.id, ok: true, out })
      console.log('ok', path.relative(webRoot, out))
    } catch (error) {
      results.push({ id: shot.id, ok: false, error: String(error) })
      console.log('FAIL', error?.message || error)
    }
  }

  await browser.close()

  const failed = results.filter((r) => !r.ok)
  const manifest = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    shots: results,
  }
  await fs.writeFile(
    path.join(outRoot, 'capture-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  )

  console.log(
    `[docs:screenshots] done — ${results.length - failed.length}/${results.length} ok`
  )
  if (failed.length) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
