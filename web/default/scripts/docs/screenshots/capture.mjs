#!/usr/bin/env node
/**
 * Capture product docs screenshots from the live BoxAI UI.
 *
 * - Public pages: plain navigation to BASE_URL
 * - Console pages: admin management token + New-Api-User header injection
 *   (real backend UI — no HTML fixtures)
 *
 * Writes WebP at 480 / 960 / 1536 under public/doc-assets/screenshots/
 *
 * Auth (required for console shots):
 *   BOXAI_ADMIN_TOKEN   system management access token
 *   BOXAI_ADMIN_USER_ID numeric admin user id
 *   BOXAI_BASE_URL      optional override (default DOCS_SHOTS_BASE_URL / you-box.com)
 *
 * Usage:
 *   bun run docs:screenshots
 *   DOCS_SHOTS_BASE_URL=https://you-box.com bun run docs:screenshots
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(__dirname, '../../..')
const outRoot = path.join(webRoot, 'public/doc-assets/screenshots')

const BASE_URL = (
  process.env.DOCS_SHOTS_BASE_URL ||
  process.env.BOXAI_BASE_URL ||
  'https://you-box.com'
).replace(/\/$/, '')
const WIDTHS = [480, 960, 1536]
const VIEWPORT = { width: 1440, height: 900 }
const LOCALE = 'en'
const MODEL_DETAIL_ID =
  process.env.DOCS_SHOTS_MODEL_ID || 'gemini-3.6-flash'

const ADMIN_TOKEN = (process.env.BOXAI_ADMIN_TOKEN || '').trim()
const ADMIN_USER_ID = (process.env.BOXAI_ADMIN_USER_ID || '').trim()

/**
 * @typedef {'public' | 'auth'} ShotAuth
 * @typedef {{
 *   id: string,
 *   area: string,
 *   name: string,
 *   auth: ShotAuth,
 *   path: string,
 *   waitMs?: number,
 *   waitFor?: string,
 *   fullPage?: boolean,
 *   prepare?: (page: import('playwright').Page) => Promise<void>,
 * }} Shot
 */

/** @type {Shot[]} */
const SHOTS = [
  {
    id: 'auth-sign-in',
    area: 'auth',
    name: 'sign-in',
    auth: 'public',
    path: '/sign-in',
    waitMs: 2000,
    waitFor: 'form, input[type="password"], input[type="email"]',
  },
  {
    id: 'console-model-hub',
    area: 'console',
    name: 'model-hub',
    auth: 'public',
    path: '/pricing',
    waitMs: 3500,
    waitFor: 'main',
  },
  {
    id: 'console-model-hub-detail',
    area: 'console',
    name: 'model-hub-detail',
    auth: 'public',
    path: `/pricing/${encodeURIComponent(MODEL_DETAIL_ID)}`,
    waitMs: 3500,
    waitFor: 'main',
  },
  {
    id: 'console-api-keys',
    area: 'console',
    name: 'api-keys-empty',
    auth: 'auth',
    path: '/keys',
    waitMs: 3500,
    waitFor: 'main',
  },
  {
    id: 'console-api-keys-create',
    area: 'console',
    name: 'api-keys-create',
    auth: 'auth',
    path: '/keys',
    waitMs: 2500,
    waitFor: 'main',
    prepare: async (page) => {
      const createBtn = page
        .getByRole('button', { name: /create api key/i })
        .first()
      await createBtn.waitFor({ state: 'visible', timeout: 20000 })
      await createBtn.click()
      await page
        .locator('#api-key-form, form')
        .first()
        .waitFor({ state: 'visible', timeout: 15000 })
      await page.waitForTimeout(600)
    },
  },
  {
    id: 'console-api-keys-created',
    area: 'console',
    name: 'api-keys-created',
    auth: 'auth',
    path: '/keys',
    waitMs: 3000,
    waitFor: 'main',
    prepare: async (page) => {
      // Reveal the full key in the first row popover (real console UI).
      const keyTrigger = page
        .locator('button')
        .filter({ has: page.locator('span.truncate, span.font-mono') })
        .filter({ hasText: /^sk-/ })
        .first()
      if ((await keyTrigger.count()) === 0) {
        // Fallback: any mono truncated key cell
        const fallback = page.locator('button').filter({ hasText: /sk-/ }).first()
        await fallback.waitFor({ state: 'visible', timeout: 20000 })
        await fallback.click()
      } else {
        await keyTrigger.waitFor({ state: 'visible', timeout: 20000 })
        await keyTrigger.click()
      }
      await page
        .getByText(/full api key/i)
        .first()
        .waitFor({ state: 'visible', timeout: 15000 })
      await page.waitForTimeout(800)
    },
  },
  {
    id: 'console-billing-topup',
    area: 'console',
    name: 'billing-topup',
    auth: 'auth',
    path: '/billing',
    waitMs: 3500,
    waitFor: 'main',
  },
  {
    id: 'console-usage-logs',
    area: 'console',
    name: 'usage-logs',
    auth: 'auth',
    path: '/usage-logs/common',
    waitMs: 3500,
    waitFor: 'main',
  },
  {
    id: 'console-dashboard',
    area: 'console',
    name: 'dashboard',
    auth: 'auth',
    path: '/dashboard/overview',
    waitMs: 4000,
    waitFor: 'main',
  },
  {
    id: 'playground-chat',
    area: 'playground',
    name: 'chat-success',
    auth: 'auth',
    path: '/playground',
    waitMs: 4000,
    waitFor: 'main, textarea, [contenteditable="true"]',
  },
  {
    id: 'start-docs-home',
    area: 'start',
    name: 'docs-home',
    auth: 'public',
    path: '/docs/start/what-is-boxai',
    waitMs: 2500,
    waitFor: 'main, article, [data-docs-page]',
  },
  {
    id: 'start-getting-started',
    area: 'start',
    name: 'getting-started',
    auth: 'public',
    path: '/docs/start/getting-started',
    waitMs: 2500,
    waitFor: 'main, article, [data-docs-page]',
  },
  {
    id: 'clients-downloads',
    area: 'clients',
    name: 'downloads',
    auth: 'public',
    path: '/downloads',
    waitMs: 3000,
    waitFor: 'main',
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

/**
 * Probe management auth from Node (not in-page fetch on about:blank).
 * @returns {Promise<{ id: number, username: string, role: number, [k: string]: unknown }>}
 */
async function loadAdminUser() {
  if (!ADMIN_TOKEN || !ADMIN_USER_ID) {
    throw new Error(
      'BOXAI_ADMIN_TOKEN and BOXAI_ADMIN_USER_ID are required for console screenshots'
    )
  }
  const res = await fetch(`${BASE_URL}/api/user/self`, {
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'New-Api-User': ADMIN_USER_ID,
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    throw new Error(`admin self probe HTTP ${res.status}`)
  }
  const body = await res.json()
  if (!body?.success || !body?.data) {
    throw new Error(`admin self probe failed: ${body?.message || 'unknown'}`)
  }
  return body.data
}

/**
 * @param {import('playwright').Browser} browser
 * @param {Shot} shot
 * @param {{ user: object, uid: string } | null} auth
 */
async function captureShot(browser, shot, auth) {
  const needsAuth = shot.auth === 'auth'
  if (needsAuth && !auth) {
    throw new Error('auth context required')
  }

  /** @type {import('playwright').BrowserContextOptions} */
  const contextOptions = {
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-US',
    serviceWorkers: 'block',
    baseURL: BASE_URL,
  }

  if (needsAuth && auth) {
    contextOptions.extraHTTPHeaders = {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'New-Api-User': auth.uid,
    }
  }

  const context = await browser.newContext(contextOptions)

  if (needsAuth && auth) {
    await context.addInitScript(
      ({ userJson, uid }) => {
        try {
          window.localStorage.setItem('user', userJson)
          window.localStorage.setItem('uid', uid)
        } catch {
          /* ignore */
        }
      },
      { userJson: JSON.stringify(auth.user), uid: auth.uid }
    )
  }

  const page = await context.newPage()
  try {
    const response = await page.goto(shot.path, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    })
    if (response && response.status() >= 400) {
      throw new Error(`HTTP ${response.status()} for ${shot.path}`)
    }

    // Bail if auth injection failed and we landed on sign-in.
    if (needsAuth) {
      const url = page.url()
      if (url.includes('/sign-in')) {
        throw new Error(`auth redirect to sign-in for ${shot.path} (url=${url})`)
      }
    }

    if (shot.waitFor) {
      await page
        .locator(shot.waitFor)
        .first()
        .waitFor({ state: 'visible', timeout: 30000 })
        .catch(() => {})
    }
    await page.waitForTimeout(shot.waitMs ?? 1500)

    await page.evaluate(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.style.colorScheme = 'light'
    })

    if (shot.prepare) {
      await shot.prepare(page)
    }

    await page.waitForTimeout(200)

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

  const authShots = SHOTS.filter((s) => s.auth === 'auth')
  let auth = null
  if (authShots.length > 0) {
    process.stdout.write('[docs:screenshots] probing admin auth … ')
    const user = await loadAdminUser()
    auth = { user, uid: String(user.id ?? ADMIN_USER_ID) }
    console.log(`ok user=${user.username || auth.uid}`)
  }

  const browser = await chromium.launch({ headless: true })
  const results = []

  for (const shot of SHOTS) {
    process.stdout.write(`[docs:screenshots] ${shot.id} … `)
    try {
      const png = await captureShot(
        browser,
        shot,
        shot.auth === 'auth' ? auth : null
      )
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
    mode: 'live-ui',
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
