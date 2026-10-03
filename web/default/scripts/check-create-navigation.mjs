import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

import { chromium } from 'playwright'

// Run against `bun run build && bun run preview --port 4173`, not the dev
// server: the redirect regression requires production route code splitting.
const baseURL = process.env.BASE_URL || 'http://localhost:4173'
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
})

try {
  for (const tool of ['image', 'video']) {
    const context = await browser.newContext()
    try {
      await context.addInitScript((lastTool) => {
        localStorage.setItem('i18nextLng', 'en')
        if (lastTool !== 'image') {
          localStorage.setItem(
            'create_store_v1',
            JSON.stringify({
              version: 1,
              state: { lastTool },
            })
          )
        }
      }, tool)
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) =>
        errors.push(error.message || String(error))
      )
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      // Slow route chunks past the router's 300ms pending threshold. This
      // exercises the production-only redirected-match race, not an eager
      // dev import or a warm cached navigation.
      await page.route('**/static/js/async/**', async (route) => {
        await delay(600)
        await route.continue()
      })
      await page.route('**/api/**', async (route) => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/api/status') {
          // Resolve the module-access guard after pending UI has mounted,
          // while the destination's route chunk is still in flight.
          await delay(400)
          await route.fulfill({
            json: { success: true, data: { system_name: 'BoxAI' } },
          })
          return
        }
        if (pathname === '/api/setup') {
          await delay(400)
          await route.fulfill({
            json: { success: true, data: { status: true } },
          })
          return
        }
        if (pathname === '/api/notice') {
          await route.fulfill({ json: { success: true, data: '' } })
          return
        }
        await route.fulfill({ json: { success: true, data: [] } })
      })
      await page.goto(`${baseURL}/create`)
      await page.waitForURL(`**/create/${tool}`)
      await page.getByRole('textbox').first().waitFor()
      assert.deepEqual(errors, [], `cold redirect to ${tool} must not crash`)
      assert.equal(
        await page
          .locator(`nav[aria-label="Creation tools"] a[href="/create/${tool}"]`)
          .innerText(),
        tool === 'image' ? 'Image' : 'Video'
      )
      await page.reload()
      await page.getByRole('textbox').first().waitFor()
      await page.locator('header a[href="/playground"]').click()
      await page.waitForURL('**/playground')
      await page.locator('header a[href="/create"]').click()
      await page.waitForURL(`**/create/${tool}`)
      await page.getByRole('textbox').first().waitFor()
      assert.deepEqual(errors, [], 'reload and Chat → Create must not crash')
      console.log(`PASS: cold /create → ${tool}, reload, Chat → Create`)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}
