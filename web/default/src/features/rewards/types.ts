export type RewardCampaignStatus =
  | 'active'
  | 'scheduled'
  | 'ended'
  | 'sold_out'
  | 'disabled'

export interface RewardCampaign {
  id: number
  slug: string
  name: string
  description?: string
  status: number
  quota: number
  starts_at: number
  ends_at: number
  max_claims: number
  claimed_count: number
  per_user_limit: number
  new_users_only: boolean
  require_verified: boolean
  created_by: number
  created_time: number
  updated_time: number
}

export interface RewardPublicCampaign {
  slug: string
  name: string
  description?: string
  quota: number
  status: RewardCampaignStatus
  starts_at: number
  ends_at: number
  remaining_claims?: number | null
  new_users_only: boolean
  require_verified: boolean
  enabled: boolean
}

export interface RewardSummary {
  reward_quota: number
  reward_history: number
  min_redeem_quota: number
  enabled: boolean
}

export interface RewardLedgerEntry {
  id: number
  user_id: number
  delta: number
  balance_after: number
  type: 'claim' | 'redeem' | 'expire' | 'adjust' | string
  ref_type: string
  ref_id: number
  note: string
  created_time: number
}

export interface RewardClaim {
  id: number
  campaign_id: number
  user_id: number
  quota: number
  claimed_time: number
  client_ip?: string
  user_agent?: string
}

export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface RewardCampaignFormValues {
  slug: string
  name: string
  description: string
  status: number
  amount_display: number
  starts_at?: Date
  ends_at?: Date
  max_claims: number
  per_user_limit: number
  new_users_only: boolean
  require_verified: boolean
}
