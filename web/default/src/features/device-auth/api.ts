import { api } from '@/lib/api'

import type { DeviceAuthApproveResponse, DeviceAuthInfoResponse } from './types'

export async function getDeviceAuthInfo(
  userCode: string
): Promise<DeviceAuthInfoResponse> {
  // The page renders lookup failures inline, so suppress the global toast.
  const res = await api.get<DeviceAuthInfoResponse>(
    `/api/device/info?user_code=${encodeURIComponent(userCode)}`,
    { skipBusinessError: true }
  )
  return res.data
}

export async function approveDeviceAuth(
  userCode: string,
  approve: boolean
): Promise<DeviceAuthApproveResponse> {
  const res = await api.post<DeviceAuthApproveResponse>('/api/device/approve', {
    user_code: userCode,
    approve,
  })
  return res.data
}
