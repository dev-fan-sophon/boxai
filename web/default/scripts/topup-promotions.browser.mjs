import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

import { chromium } from 'playwright'

// Real browser against the development app; all API requests are intercepted.
// No production users, payment orders, or settings are written.
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'
const artifacts = new URL('../../../.amp/in/artifacts/', import.meta.url)
  .pathname
await fs.mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  locale: 'en-US',
  reducedMotion: 'reduce',
})
const user = {
  id: 7,
  username: 'demo-admin',
  role: 100,
  quota: 2000000,
  used_quota: 0,
  group: 'default',
  setting: '{}',
}
let promotion = {
  id: 1,
  enabled: true,
  starts_at: 0,
  ends_at: 0,
  min_amount: 100000,
  percent_off: 30,
  max_discount: 100000,
  per_user_limit: 2,
  total_budget: 10000000,
  banner_enabled: true,
  banner_text: '',
  banner_position: 'console_top',
}
let coupon = {
  id: 1,
  code: 'WELCOME',
  enabled: true,
  starts_at: 0,
  ends_at: 0,
  min_amount: 100000,
  discount_type: 'percent',
  discount_value: 10,
  max_discount: 100000,
  total_limit: 100,
  per_user_limit: 1,
  user_id: 0,
  stackable: true,
}
const expires = Math.floor(Date.now() / 1000) + 86400
const snapshot = {
  face_amount: 100000,
  activity_discount: 30000,
  coupon_discount: 7000,
  coupon_code: 'WELCOME',
  credit_usd: 4,
  paid_amount: 63000,
  expires_at: expires,
}
let record = {
  id: 1,
  user_id: 7,
  amount: 4,
  money: 63000,
  trade_no: 'DEMO-ORDER',
  payment_method: 'bank_qr',
  status: 'pending',
  submission_status: '',
  create_time: Math.floor(Date.now() / 1000),
  ...snapshot,
}
const review = {
  id: 4,
  user_id: 7,
  username: 'demo-user',
  trade_no: 'DEMO-REVIEW',
  order_type: 'balance',
  bank_transaction_no: 'BANK123',
  note: 'Demo payment proof',
  status: 'submitted',
  submitted_at: Math.floor(Date.now() / 1000),
  amount: 4,
  money: 63000,
  currency: 'VND',
  ...snapshot,
}
const requests = []
let releaseSlow
let slowSeen
const slowRequest = new Promise((resolve) => {
  slowSeen = resolve
})
const slowResponse = new Promise((resolve) => {
  releaseSlow = resolve
})
await context.addInitScript((value) => {
  localStorage.setItem('user', JSON.stringify(value))
  localStorage.setItem('i18nextLng', 'en')
}, user)
await context.route('**/api/**', async (route) => {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname
  const body = request.postData()
  requests.push({ path, method: request.method(), body })
  let data = {}
  if (path === '/api/user/self') data = user
  else if (path === '/api/setup') data = { status: true }
  else if (path === '/api/notice') data = ''
  else if (path === '/api/status') {
    data = {
      system_name: 'BoxAI',
      quota_display_type: 'VND',
      usd_exchange_rate: 25000,
      quota_per_unit: 500000,
      display_in_currency: true,
    }
  } else if (path.endsWith('/topup/promotion')) {
    if (request.method() === 'PUT') promotion = JSON.parse(body)
    data = promotion
  } else if (path.startsWith('/api/topup/coupons')) {
    if (request.method() !== 'GET') {
      coupon = { ...JSON.parse(body), id: 1 }
      data = coupon
    } else data = { items: [coupon], total: 1 }
  } else if (path === '/api/option/') data = []
  else if (path === '/api/user/topup/info') {
    data = {
      enable_bank_qr_topup: true,
      bank_qr_min_topup: 100000,
      pay_methods: [{ type: 'bank_qr', name: 'Bank QR', min_topup: 100000 }],
      amount_options: [100000, 200000, 500000, 1000000],
      discount: {},
    }
  } else if (path === '/api/user/bank-qr/amount') {
    const value = JSON.parse(body)
    if (value.amount === 200000) {
      slowSeen()
      await slowResponse
    }
    if (value.coupon_code === 'BAD') {
      return route.fulfill({
        status: 400,
        json: {
          success: false,
          code: 'topup_coupon_unavailable',
          message: 'Coupon is not eligible',
        },
      })
    }
    data = {
      amount: value.amount * 0.7,
      face_amount: value.amount,
      activity_discount: value.amount * 0.3,
      coupon_discount: 0,
      coupon_code: '',
      credit_usd: value.amount / 25000,
      expires_at: expires,
      currency: 'VND',
    }
    if (value.coupon_code === 'WELCOME') {
      data = {
        ...data,
        amount: value.amount * 0.63,
        coupon_discount: value.amount * 0.07,
        coupon_code: 'WELCOME',
      }
    }
  } else if (path === '/api/user/bank-qr/pay') {
    // Intentionally differs from the quote: verifies the pay response is authoritative.
    data = {
      ...snapshot,
      amount: 65000,
      coupon_discount: 5000,
      currency: 'VND',
      trade_no: 'DEMO-ORDER',
      payload: 'DEMO-VIETQR-AMOUNT-65000',
      transfer_content: 'BOXAI DEMO',
      bank_name: 'Demo Bank',
      bank_bin: '970436',
      account_name: 'BOXAI DEMO',
      account_number: '0000123456',
    }
  } else if (path.endsWith('/cancel')) {
    record = { ...record, status: 'cancelled' }
    data = null
  } else if (path.endsWith('/submissions')) {
    data = request.method() === 'GET' ? [] : { id: 9, status: 'submitted' }
  } else if (path === '/api/user/topup/reviews') {
    data = { items: [review], total: 1, page: 1, page_size: 12 }
  } else if (path === '/api/user/topup' || path === '/api/user/topup/self') {
    data = { items: [record], total: 1 }
  } else if (path === '/api/subscription/plans') data = []
  else if (path === '/api/subscription/self') {
    data = {
      subscriptions: [],
      all_subscriptions: [],
      pending_bank_qr_orders: [],
    }
  }
  return route.fulfill({ json: { success: true, message: '', data } })
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') console.error(message.text())
})
try {
  await page.goto(`${base}/pricing-center/payments`)
  await page
    .getByRole('button', { name: 'Save promotion', exact: true })
    .waitFor()
  await page.getByLabel('Enable promotion', { exact: true }).uncheck()
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/topup/promotion') &&
        response.request().method() === 'PUT'
    ),
    page.getByRole('button', { name: 'Save promotion', exact: true }).click(),
  ])
  assert.equal(promotion.enabled, false)
  await page.getByLabel('Enable promotion', { exact: true }).check()
  await page
    .getByRole('button', { name: 'Save promotion', exact: true })
    .click()
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Coupon code', { exact: true }).fill('SAVE10')
  await dialog.getByLabel('Allow stacking with promotion').check()
  await dialog.getByRole('button', { name: 'Save coupon' }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(coupon.code, 'SAVE10')
  assert.equal(coupon.stackable, true)
  await page.getByLabel('Enable email alerts').check()
  await page.getByRole('button', { name: 'Save email alerts' }).click()
  await page
    .getByRole('alert')
    .filter({ hasText: 'Enter up to 10 valid' })
    .waitFor()
  await page
    .getByLabel('Recipient emails (one per line, up to 10)')
    .fill('review@example.com')
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/option/') &&
        response.request().method() === 'PUT'
    ),
    page.getByRole('button', { name: 'Save email alerts' }).click(),
  ])
  assert.deepEqual(
    JSON.parse(
      JSON.parse(
        requests.find(
          (request) =>
            request.path === '/api/option/' && request.method === 'PUT'
        ).body
      ).value
    ),
    { enabled: true, recipients: ['review@example.com'] }
  )
  await page
    .getByRole('button', { name: 'Save promotion', exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${artifacts}/topup-promotion-admin.png` })
  await page.goto(`${base}/billing`)
  await page.getByRole('button', { name: 'Add credits', exact: true }).click()
  await page.getByRole('button', { name: /Bank QR/ }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: /₫200,000/ }).click()
  await slowRequest
  await page.getByRole('button', { name: /^₫100,000/ }).click()
  await page
    .getByRole('dialog')
    .getByRole('definition')
    .filter({ hasText: /70,000/ })
    .waitFor()
  const staleDone = page.waitForResponse(
    (response) =>
      response.url().endsWith('/bank-qr/amount') &&
      response.request().postDataJSON().amount === 200000
  )
  releaseSlow()
  await staleDone
  await page.getByLabel('Coupon code', { exact: true }).fill('BAD')
  assert.equal(
    await page.getByRole('button', { name: 'Continue to pay' }).isDisabled(),
    true
  )
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await page
    .getByText(
      'This coupon is invalid, unavailable, not eligible, or has reached its usage limit.',
      { exact: true }
    )
    .waitFor()
  assert.equal(
    await page.getByRole('button', { name: 'Continue to pay' }).isDisabled(),
    true
  )
  await page.getByLabel('Coupon code', { exact: true }).fill('WELCOME')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await page
    .getByRole('definition')
    .filter({ hasText: /63,000/ })
    .first()
    .waitFor()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Continue to pay' }).click()
  await page.getByRole('alertdialog').waitFor()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Confirm Payment' })
    .click()
  await page.getByRole('button', { name: 'I have paid' }).waitFor()
  assert.match(await page.getByRole('dialog').innerText(), /65,000/)
  assert.doesNotMatch(await page.getByRole('dialog').innerText(), /63,000/)
  await page.screenshot({ path: `${artifacts}/topup-payment-qr.png` })
  await page.getByRole('button', { name: 'I have paid' }).click()
  await page
    .getByLabel('Bank transaction number', { exact: true })
    .fill('BANK-DEMO-123')
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/submissions') &&
        response.request().method() === 'POST'
    ),
    page
      .getByRole('button', { name: 'Submit payment proof', exact: true })
      .click(),
  ])
  assert.equal(
    requests.filter((request) => request.path.endsWith('/complete')).length,
    0
  )
  await page.goto(`${base}/pricing-center/topup-reviews`)
  await page.getByText('DEMO-REVIEW', { exact: true }).waitFor()
  await page.screenshot({ path: `${artifacts}/topup-review-snapshot.png` })
  assert.match(await page.locator('body').innerText(), /63,000/)
  user.role = 1
  user.username = 'demo-user'
  await page.goto(`${base}/billing`)
  await page
    .getByRole('button', { name: 'Cancel order', exact: true })
    .waitFor()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click()
  await page.getByText('Cancelled', { exact: true }).waitFor()
  assert.equal(record.status, 'cancelled')
  record = { ...record, status: 'pending', submission_status: 'submitted' }
  await page.reload()
  await page
    .getByText('Payment proof submitted. Please wait for review.', {
      exact: true,
    })
    .waitFor()
  assert.equal(
    await page
      .getByRole('button', { name: 'Cancel order', exact: true })
      .count(),
    0
  )
  record = {
    ...record,
    submission_status: '',
    expires_at: Math.floor(Date.now() / 1000) - 1,
  }
  await page.reload()
  await page
    .getByText('Payment expired. Do not transfer funds.', { exact: true })
    .waitFor()
  assert.equal(
    await page
      .getByRole('button', { name: 'Submit payment proof', exact: true })
      .isDisabled(),
    true
  )
  await context.addInitScript(() => localStorage.setItem('i18nextLng', 'vi'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.getByText(/Nạp từ 100.*giảm 30/).waitFor()
  await page.getByRole('button', { name: 'Thêm tín dụng', exact: true }).click()
  await page.getByRole('button', { name: /Bank QR|QR ngân hàng/ }).click()
  await page.getByLabel('Mã ưu đãi', { exact: true }).fill('WELCOME')
  await page.getByRole('button', { name: 'Áp dụng', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByText('Mệnh giá nạp', { exact: true })
    .waitFor()
  await page.screenshot({ path: `${artifacts}/topup-quote-mobile-vi.png` })
  await page.getByLabel('Mã ưu đãi', { exact: true }).fill('BAD')
  await page.getByRole('button', { name: 'Áp dụng', exact: true }).click()
  await page
    .getByText(
      'Mã không hợp lệ, không khả dụng, không đủ điều kiện hoặc đã hết lượt sử dụng.',
      { exact: true }
    )
    .waitFor()
  assert.equal(
    await page.getByText('Coupon is not eligible', { exact: true }).count(),
    0
  )
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    ),
    false
  )
  assert.deepEqual(errors, [])
  console.log(
    'PASS: promotion/coupon saves; email validation/payload; stale amount quote ignored; draft/invalid coupon blocks pay; HTTP400 coupon localized en/vi; authoritative pay snapshot; proof without direct credit; review snapshot; cancel; submitted/expired guards; mobile Vietnamese quote'
  )
} catch (error) {
  console.error(page.url(), await page.locator('body').innerText(), errors)
  throw error
} finally {
  releaseSlow()
  await browser.close()
}
