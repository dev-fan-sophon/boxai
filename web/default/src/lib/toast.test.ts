import { AxiosError, AxiosHeaders } from 'axios'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getServerErrorMessage, markErrorReported, toastPromise } from './toast'

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(() => 'toast-id'),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}))

function axiosErrorWith(data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError(
    'Request failed with status code 500',
    '500',
    config,
    null,
    {
      data,
      status: 500,
      statusText: 'Internal Server Error',
      headers: {},
      config,
    }
  )
}

describe('toastPromise', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('turns the loading toast into the success toast and returns the value', async () => {
    const result = await toastPromise(Promise.resolve({ success: true }), {
      loading: 'Saving',
      success: 'Saved',
    })

    expect(result).toEqual({ success: true })
    expect(toast.loading).toHaveBeenCalledWith('Saving')
    expect(toast.success).toHaveBeenCalledWith('Saved', { id: 'toast-id' })
  })

  it('skips the loading toast when no loading message is given', async () => {
    await toastPromise(Promise.resolve(1), { success: (n) => `got ${n}` })

    expect(toast.loading).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('got 1', { id: undefined })
  })

  it('treats an unreported { success: false } envelope as a failure without throwing', async () => {
    const envelope = { success: false, message: 'Quota exceeded' }
    const result = await toastPromise(Promise.resolve(envelope), {
      loading: 'Saving',
      success: 'Saved',
    })

    expect(result).toBe(envelope)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Quota exceeded', {
      id: 'toast-id',
    })
  })

  it('only clears the pending toast for a failure the API layer already reported', async () => {
    const envelope = { success: false, message: 'Quota exceeded' }
    markErrorReported(envelope)

    await toastPromise(Promise.resolve(envelope), {
      loading: 'Saving',
      success: 'Saved',
    })

    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.dismiss).toHaveBeenCalledWith('toast-id')
  })

  it('shows the server message for a rejected request and re-throws', async () => {
    const error = axiosErrorWith({ message: 'Key not found' })

    await expect(
      toastPromise(Promise.reject(error), {
        loading: 'Deleting',
        success: 'Deleted',
      })
    ).rejects.toBe(error)
    expect(toast.error).toHaveBeenCalledWith('Key not found', {
      id: 'toast-id',
    })
  })

  it('prefers the caller error message for unreported failures', async () => {
    await expect(
      toastPromise(Promise.reject(new Error('boom')), {
        success: 'Saved',
        error: 'Save failed, please retry',
      })
    ).rejects.toThrow('boom')
    expect(toast.error).toHaveBeenCalledWith('Save failed, please retry', {
      id: undefined,
    })
  })
})

describe('getServerErrorMessage', () => {
  it('reads message, then title, then the transport error', () => {
    expect(getServerErrorMessage(axiosErrorWith({ message: 'm' }))).toBe('m')
    expect(getServerErrorMessage(axiosErrorWith({ title: 't' }))).toBe('t')
    expect(getServerErrorMessage(axiosErrorWith({}))).toBe(
      'Request failed with status code 500'
    )
  })
})
