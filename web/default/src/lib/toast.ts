import { isAxiosError } from 'axios'
import i18next from 'i18next'
import { toast } from 'sonner'

/*
 * Toast feedback for async actions.
 *
 * The axios interceptors in `lib/api.ts` already toast every failed request —
 * both HTTP errors and `{ success: false }` business envelopes — unless the
 * request opted out with `skipErrorHandler` / `skipBusinessError`. Call sites
 * that also wrote `toast.error(res.message)` therefore showed the same failure
 * twice. The interceptors now mark what they reported, and `toastPromise`
 * reads that mark: a failure the API layer already surfaced only clears the
 * pending toast, anything else becomes the error toast.
 */

const REPORTED = Symbol.for('boxai.toast.reported')

/** Record that a failure has been shown to the user (see `lib/api.ts`). */
export function markErrorReported(target: unknown): void {
  if (target === null || typeof target !== 'object') return
  try {
    Object.defineProperty(target, REPORTED, { value: true })
  } catch {
    /* frozen object — worst case the failure is shown twice */
  }
}

export function isErrorReported(target: unknown): boolean {
  if (target === null || typeof target !== 'object') return false
  return (target as Record<symbol, unknown>)[REPORTED] === true
}

/**
 * The user-facing message for a failed request: the backend's `message`,
 * then its `title`, then the transport error, then a generic fallback.
 */
export function getServerErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as
      | { message?: unknown; title?: unknown }
      | undefined
    if (typeof data?.message === 'string' && data.message) return data.message
    if (typeof data?.title === 'string' && data.title) return data.title
  }
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return i18next.t('Something went wrong!')
}

type ApiEnvelope = { success: boolean; message?: string }

function isFailedEnvelope(value: unknown): value is ApiEnvelope {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as ApiEnvelope).success === false
  )
}

type Message<T> = string | ((value: T) => string)

export interface ToastPromiseMessages<T> {
  /**
   * Shown while pending. Omit it when the trigger already shows its own
   * pending state (a `<Button loading>`), so the action is not announced twice.
   */
  loading?: string
  success: Message<T>
  /**
   * For failures the API layer did not already toast (requests sent with
   * `skipErrorHandler` / `skipBusinessError`, or non-HTTP errors). Defaults
   * to the server's message, see `getServerErrorMessage`.
   */
  error?: Message<unknown>
}

function resolveMessage<T>(message: Message<T>, value: T): string {
  return typeof message === 'function' ? message(value) : message
}

/**
 * Wraps an API call in loading → success / error toasts and resolves with
 * the call's own result, so callers keep their control flow:
 *
 * ```ts
 * const res = await toastPromise(deleteApiKey(id), {
 *   loading: t('Deleting...'),
 *   success: t('API Key deleted successfully'),
 * })
 * if (res.success) close()
 * ```
 *
 * A resolved `{ success: false }` envelope counts as a failure for the toast
 * but is still returned (not thrown). Rejections are re-thrown after the
 * toast is shown. Built on the same toast id sonner's `toast.promise` uses,
 * but hand-rolled because `toast.promise` cannot skip the error toast for a
 * failure the API layer already reported.
 */
export async function toastPromise<T>(
  promise: Promise<T>,
  messages: ToastPromiseMessages<T>
): Promise<T> {
  const id =
    messages.loading === undefined ? undefined : toast.loading(messages.loading)

  const fail = (error: unknown, fallback: string) => {
    // The interceptor's toast carries the server's own wording; a second,
    // generic one underneath it would only be noise.
    if (isErrorReported(error)) {
      if (id !== undefined) toast.dismiss(id)
      return
    }
    const text =
      messages.error === undefined
        ? fallback
        : resolveMessage(messages.error, error)
    toast.error(text, { id })
  }

  try {
    const value = await promise
    if (isFailedEnvelope(value)) {
      fail(value, value.message || i18next.t('Request failed'))
      return value
    }
    toast.success(resolveMessage(messages.success, value), { id })
    return value
  } catch (error) {
    fail(error, getServerErrorMessage(error))
    throw error
  }
}
