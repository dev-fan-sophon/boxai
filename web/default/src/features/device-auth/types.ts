export type DeviceAuthInfo = {
  user_code: string
  client_name: string
  client_ip: string
  created_at: number
  expires_at: number
}

export type DeviceAuthInfoResponse = {
  success: boolean
  message: string
  data?: DeviceAuthInfo
}

export type DeviceAuthApproveResponse = {
  success: boolean
  message: string
  data?: {
    status: 'approved' | 'denied'
    token_name?: string
  }
}
