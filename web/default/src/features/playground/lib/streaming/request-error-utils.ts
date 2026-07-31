import { ERROR_MESSAGES } from '../../constants'

type RequestErrorLike = {
  message?: string
  response?: {
    data?: {
      error?: {
        code?: string
        message?: string
        param?: string
        type?: string
      }
      message?: string
    }
  }
}

export type RequestErrorDetails = {
  errorCode?: string
  errorMessage: string
}

function formatOpenAIErrorMessage(
  error:
    | {
        code?: string
        message?: string
        param?: string
      }
    | undefined
): string | undefined {
  if (!error?.message || typeof error.message !== 'string') return undefined
  const message = error.message.trim()
  if (!message) return undefined
  if (error.param && typeof error.param === 'string' && error.param.trim()) {
    return `${message} (${error.param})`
  }
  return message
}

export function parseRequestErrorDetails(error: unknown): RequestErrorDetails {
  const requestError = error as RequestErrorLike
  const data = requestError?.response?.data
  const openAIMessage = formatOpenAIErrorMessage(data?.error)

  return {
    errorCode: data?.error?.code || undefined,
    errorMessage:
      openAIMessage ||
      (typeof data?.message === 'string' ? data.message : undefined) ||
      requestError?.message ||
      ERROR_MESSAGES.API_REQUEST_ERROR,
  }
}
