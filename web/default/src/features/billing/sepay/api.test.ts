import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import {
  cancelSePayInvoice,
  createSePayInvoice,
  getSePayInvoice,
  quoteSePay,
} from './api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

describe('SePay payment API', () => {
  beforeEach(() => vi.resetAllMocks())

  it('quotes whole VND independently of bank QR coupons', async () => {
    const quote = { amount: 25000, currency: 'VND', credit_usd: 1 }
    vi.mocked(api.post).mockResolvedValue({
      data: { success: true, data: quote },
    })
    expect(await quoteSePay(25000)).toEqual({ success: true, data: quote })
    expect(api.post).toHaveBeenCalledWith('/api/user/sepay/amount', {
      amount: 25000,
    })
  })

  it.each([
    [{ amount: 25000 }, '/api/user/sepay/pay'],
    [{ plan_id: 7 }, '/api/subscription/sepay/pay'],
  ] as const)('creates a persisted invoice for %j', async (input, endpoint) => {
    const invoice = { trade_no: 'SEP1', amount: 25000, status: 'pending' }
    vi.mocked(api.post).mockResolvedValue({
      data: { success: true, data: invoice },
    })
    expect(await createSePayInvoice(input)).toEqual(invoice)
    expect(api.post).toHaveBeenCalledWith(endpoint, input)
  })

  it('resumes an owned invoice without requesting live configuration', async () => {
    const invoice = { trade_no: 'SEP/1', status: 'expired' }
    const signal = new AbortController().signal
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: invoice },
    })
    expect(await getSePayInvoice('SEP/1', signal)).toEqual(invoice)
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/api/user/sepay/SEP%2F1', {
      signal,
    })
  })

  it('cancels using only the SePay endpoint and rejects unsuccessful responses', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { success: false, message: 'Already settled' },
    })
    await expect(cancelSePayInvoice('SEP1')).rejects.toThrow('Already settled')
    expect(api.post).toHaveBeenCalledExactlyOnceWith(
      '/api/user/sepay/SEP1/cancel'
    )
  })
})
