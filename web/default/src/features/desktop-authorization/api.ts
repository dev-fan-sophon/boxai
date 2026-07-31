import { api } from '@/lib/api'

export type DesktopAuthorizationRequest = {
  id: string
  client_id: string
  client_name: string
  redirect_uri: string
  status: string
  expires_at: number
}

type ApiEnvelope<T> = { success?: boolean; message?: string; data?: T }

export async function getDesktopAuthorizationRequest(
  requestId: string
): Promise<DesktopAuthorizationRequest> {
  const response = await api.get<
    DesktopAuthorizationRequest | ApiEnvelope<DesktopAuthorizationRequest>
  >(`/api/desktop/authorization-requests/${encodeURIComponent(requestId)}`, {
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  const body = response.data
  if ('data' in body && body.data) return body.data
  return body as DesktopAuthorizationRequest
}

export async function decideDesktopAuthorization(
  requestId: string,
  approve: boolean
): Promise<{ status: string; redirect_uri: string }> {
  const response = await api.post<
    | { status: string; redirect_uri: string }
    | ApiEnvelope<{ status: string; redirect_uri: string }>
  >(
    `/api/desktop/authorization-requests/${encodeURIComponent(requestId)}/decision`,
    { approve },
    { skipBusinessError: true, skipErrorHandler: true }
  )
  const body = response.data
  if ('data' in body && body.data) return body.data
  return body as { status: string; redirect_uri: string }
}
