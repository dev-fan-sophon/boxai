import { api } from '@/lib/api'

import type {
  ApiResponse,
  PageResult,
  RewardCampaign,
  RewardClaim,
  RewardLedgerEntry,
  RewardPublicCampaign,
  RewardSummary,
} from './types'

export async function getPublicRewardCampaign(
  slug: string
): Promise<ApiResponse<RewardPublicCampaign>> {
  const res = await api.get(`/api/reward/public/${encodeURIComponent(slug)}`, {
    skipBusinessError: true,
  })
  return res.data
}

export async function getSelfRewards(params: {
  p?: number
  page_size?: number
  type?: string
}): Promise<
  ApiResponse<{ summary: RewardSummary; ledger: PageResult<RewardLedgerEntry> }>
> {
  const query = new URLSearchParams()
  if (params.p) query.set('p', String(params.p))
  if (params.page_size) query.set('page_size', String(params.page_size))
  if (params.type) query.set('type', params.type)
  const suffix = query.toString() ? `?${query.toString()}` : ''
  const res = await api.get(`/api/user/rewards${suffix}`)
  return res.data
}

export async function claimSelfReward(
  slug: string
): Promise<ApiResponse<{ claim: RewardClaim; summary: RewardSummary }>> {
  const res = await api.post(
    '/api/user/rewards/claim',
    { slug },
    { skipBusinessError: true }
  )
  return res.data
}

export async function redeemSelfReward(
  quota: number
): Promise<ApiResponse<RewardSummary>> {
  const res = await api.post(
    '/api/user/rewards/redeem',
    { quota },
    { skipBusinessError: true }
  )
  return res.data
}

export async function getRewardCampaigns(params: {
  p?: number
  page_size?: number
  keyword?: string
  status?: string
}): Promise<ApiResponse<PageResult<RewardCampaign>>> {
  const query = new URLSearchParams()
  query.set('p', String(params.p ?? 1))
  query.set('page_size', String(params.page_size ?? 10))
  if (params.keyword) query.set('keyword', params.keyword)
  if (params.status) query.set('status', params.status)
  const res = await api.get(`/api/reward/campaign/?${query.toString()}`)
  return res.data
}

export async function createRewardCampaign(
  data: Record<string, unknown>
): Promise<ApiResponse<RewardCampaign>> {
  const res = await api.post('/api/reward/campaign/', data, {
    skipBusinessError: true,
  })
  return res.data
}

export async function updateRewardCampaign(
  id: number,
  data: Record<string, unknown>
): Promise<ApiResponse<RewardCampaign>> {
  const res = await api.put(`/api/reward/campaign/${id}`, data, {
    skipBusinessError: true,
  })
  return res.data
}

export async function getRewardClaims(params: {
  p?: number
  page_size?: number
  user_id?: number
  campaign_id?: number
}): Promise<ApiResponse<PageResult<RewardClaim>>> {
  const query = new URLSearchParams()
  query.set('p', String(params.p ?? 1))
  query.set('page_size', String(params.page_size ?? 10))
  if (params.user_id) query.set('user_id', String(params.user_id))
  if (params.campaign_id) query.set('campaign_id', String(params.campaign_id))
  const res = await api.get(`/api/reward/claim/?${query.toString()}`)
  return res.data
}

export async function getRewardLedgers(params: {
  p?: number
  page_size?: number
  user_id?: number
  type?: string
}): Promise<ApiResponse<PageResult<RewardLedgerEntry>>> {
  const query = new URLSearchParams()
  query.set('p', String(params.p ?? 1))
  query.set('page_size', String(params.page_size ?? 10))
  if (params.user_id) query.set('user_id', String(params.user_id))
  if (params.type) query.set('type', params.type)
  const res = await api.get(`/api/reward/ledger/?${query.toString()}`)
  return res.data
}

export async function adjustRewardQuota(data: {
  user_id: number
  delta: number
  note?: string
}): Promise<ApiResponse<RewardSummary>> {
  const res = await api.post('/api/reward/adjust', data, {
    skipBusinessError: true,
  })
  return res.data
}
