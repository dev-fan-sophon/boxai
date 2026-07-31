import { api } from '@/lib/api'

import type { GroupStatusResponse } from './types'

export async function getUserGroupStatus(): Promise<GroupStatusResponse> {
  const res = await api.get<GroupStatusResponse>('/api/user/self/group-status')
  return res.data
}
