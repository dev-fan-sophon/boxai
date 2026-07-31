import { z } from 'zod'

import type { AdminPermissionMatrix } from '@/lib/admin-permissions'

// ============================================================================
// User Schema & Types
// ============================================================================

/** User status: 1 = enabled, 2 = disabled, 3+ = other states */
export const userStatusSchema = z.number()
export type UserStatus = z.infer<typeof userStatusSchema>

/** User role: 1 = common user, 10 = admin, 100 = root */
export const userRoleSchema = z.number()
export type UserRole = z.infer<typeof userRoleSchema>

export const userSchema = z.object({
  id: z.number(),
  username: z.string(),
  display_name: z.string(),
  password: z.string().optional(),
  github_id: z.string().optional(),
  discord_id: z.string().optional(),
  google_id: z.string().optional(),
  facebook_id: z.string().optional(),
  zalo_id: z.string().optional(),
  oidc_id: z.string().optional(),
  wechat_id: z.string().optional(),
  telegram_id: z.string().optional(),
  email: z.string().optional(),
  quota: z.number(),
  used_quota: z.number(),
  request_count: z.number(),
  group: z.string(),
  aff_code: z.string().optional(),
  aff_count: z.number().optional(),
  aff_quota: z.number().optional(),
  aff_history_quota: z.number().optional(),
  inviter_id: z.number().optional(),
  linux_do_id: z.string().optional(),
  status: userStatusSchema,
  role: userRoleSchema,
  created_at: z.number().optional(),
  updated_at: z.number().optional(),
  last_login_at: z.number().optional(),
  DeletedAt: z.any().nullable().optional(),
  remark: z.string().optional(),
  admin_permissions: z
    .record(z.string(), z.record(z.string(), z.boolean()))
    .optional(),
})
export type User = z.infer<typeof userSchema>

export const userListSchema = z.array(userSchema)

// ============================================================================
// API Request/Response Types
// ============================================================================

/** Generic API response */
export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export type UserSortBy =
  | 'id'
  | 'username'
  | 'quota'
  | 'group'
  | 'created_at'
  | 'last_login_at'

export type UserSortOrder = 'asc' | 'desc'

export interface GetUsersParams {
  p?: number
  page_size?: number
  sort_by?: UserSortBy
  sort_order?: UserSortOrder
}

export interface GetUsersResponse {
  success: boolean
  message?: string
  data?: {
    items: User[]
    total: number
    page: number
    page_size: number
  }
}

export interface SearchUsersParams {
  keyword?: string
  group?: string
  role?: string
  status?: string
  p?: number
  page_size?: number
  sort_by?: UserSortBy
  sort_order?: UserSortOrder
}

export interface UserFormData {
  username: string
  display_name: string
  password?: string
  role?: number // Only used when creating user
  quota?: number // Only used when updating user
  group?: string // Only used when updating user
  remark?: string // Only used when updating user
  admin_permissions?: AdminPermissionMatrix
}

export type ManageUserAction =
  | 'promote'
  | 'demote'
  | 'enable'
  | 'disable'
  | 'delete'
  | 'add_quota'

export type QuotaAdjustMode = 'add' | 'subtract' | 'override'

export interface ManageUserQuotaPayload {
  id: number
  action: 'add_quota'
  mode: QuotaAdjustMode
  value: number
}

// ============================================================================
// Dialog Types
// ============================================================================

export type UsersDialogType = 'create' | 'update' | 'delete'

// ============================================================================
// Operations Console: audience filters
// ============================================================================

/** Serialized audience definition shared by the directory, segments, campaigns. */
export interface UserQueryFilter {
  keyword?: string
  group?: string
  role?: number | null
  status?: number | null
  register_source?: string
  utm_source?: string
  utm_campaign?: string
  tags?: string[]
  inviter_id?: number | null
  created_after?: number
  created_before?: number
  last_login_after?: number
  last_login_before?: number
  active_after?: number
  inactive_days?: number
  never_active?: boolean
  min_quota?: number | null
  max_quota?: number | null
  min_used_quota?: number | null
  min_topup_money?: number | null
  max_topup_money?: number | null
  min_topup_count?: number | null
  has_paid?: boolean | null
  has_subscription?: boolean | null
}

export interface UserLifecycle {
  user_id: number
  first_active_at: number
  last_active_at: number
  active_days: number
  active_days_30: number
  total_requests: number
  total_quota_used: number
  quota_7: number
  quota_30: number
  first_paid_at: number
  last_paid_at: number
  topup_count: number
  topup_money: number
  topup_amount: number
  refreshed_at: number
}

export interface AdminUserRow extends User {
  register_source?: string
  register_ip?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  register_referrer?: string
  lifecycle?: UserLifecycle
  tags?: string[]
}

export type AdminUserSortBy =
  | 'id'
  | 'username'
  | 'quota'
  | 'used_quota'
  | 'created_at'
  | 'last_login_at'
  | 'last_active_at'
  | 'topup_money'
  | 'topup_count'
  | 'quota_30'
  | 'active_days'

export interface AdminUserQueryRequest {
  filter: UserQueryFilter
  page?: number
  page_size?: number
  sort_by?: AdminUserSortBy
  sort_order?: UserSortOrder
}

export interface AdminUserQueryResult {
  items: AdminUserRow[]
  total: number
  page: number
  page_size: number
}

// ============================================================================
// Operations Console: analytics
// ============================================================================

export interface UserGrowthSummary {
  total_users: number
  new_users: number
  active_users: number
  paying_users: number
  new_paying_users: number
  revenue: number
  paid_orders: number
  quota_consumed: number
  requests: number
  outstanding_quota: number
  arpu: number
  arppu: number
}

export interface UserGrowthTrendPoint {
  day: number
  new_users: number
  active_users: number
  paying_users: number
  revenue: number
  quota: number
}

export interface UserGrowthOverview {
  current: UserGrowthSummary
  previous: UserGrowthSummary
  trend: UserGrowthTrendPoint[]
}

export interface UserFunnelStage {
  key: string
  count: number
}

export interface UserRetentionCohort {
  cohort: number
  size: number
  retained: number[]
}

export interface RevenueChannelStat {
  provider: string
  orders: number
  success_orders: number
  revenue: number
}

export interface RevenueTrendPoint {
  day: number
  topup_revenue: number
  subscription_revenue: number
  orders: number
}

export interface SubscriptionPlanStat {
  plan_id: number
  plan_name: string
  active: number
  new_sold: number
  revenue: number
}

export interface RevenueDistributionBucket {
  label: string
  users: number
}

export interface RevenueAnalytics {
  trend: RevenueTrendPoint[]
  channels: RevenueChannelStat[]
  plans: SubscriptionPlanStat[]
  lifetime_buckets: RevenueDistributionBucket[]
  repeat_buyers: number
  first_time_buyers: number
}

export interface AcquisitionChannelStat {
  channel: string
  users: number
  activated: number
  paid: number
  revenue: number
}

export interface InviterStat {
  user_id: number
  username: string
  invited: number
  paid_invited: number
  revenue: number
}

export interface AcquisitionAnalytics {
  sources: AcquisitionChannelStat[]
  utm_sources: AcquisitionChannelStat[]
  campaigns: AcquisitionChannelStat[]
  groups: AcquisitionChannelStat[]
  top_inviters: InviterStat[]
}

// ============================================================================
// Operations Console: profile, segments, campaigns
// ============================================================================

export interface UserDailyMetric {
  day: number
  requests: number
  tokens: number
  quota: number
}

export interface UserProfileRef {
  id: number
  username: string
  email: string
}

export interface UserProfileModelUsage {
  model_name: string
  requests: number
  tokens: number
  quota: number
}

export interface UserProfileTopUp {
  id: number
  amount: number
  money: number
  trade_no: string
  payment_method: string
  payment_provider: string
  status: string
  create_time: number
  complete_time: number
}

export interface UserProfileSubscription {
  id: number
  plan_id: number
  amount_total: number
  amount_used: number
  start_time: number
  end_time: number
  status: string
  source: string
}

export interface UserProfileLogEvent {
  id: number
  created_at: number
  content: string
  ip: string
}

export interface UserProfile {
  user: AdminUserRow
  lifecycle: UserLifecycle | null
  tags: string[]
  inviter: UserProfileRef | null
  invitees: UserProfileRef[]
  invitee_count: number
  daily_metrics: UserDailyMetric[]
  top_ups: UserProfileTopUp[]
  subscriptions: UserProfileSubscription[]
  top_models: UserProfileModelUsage[]
  token_count: number
  checkin_count: number
  login_events: UserProfileLogEvent[] | null
  audit_events: UserProfileLogEvent[] | null
}

export interface UserSegment {
  id: number
  name: string
  description: string
  filter: string
  cached_count: number
  refreshed_at: number
  created_by: number
  created_at: number
  updated_at: number
}

export interface UserCampaign {
  id: number
  segment_id: number
  name: string
  type: string
  status: string
  target_count: number
  success_count: number
  failed_count: number
  message: string
  created_at: number
  finished_at: number
}

export interface UserTagCount {
  tag: string
  users: number
}

export type BulkUserActionType =
  | 'quota_grant'
  | 'group_set'
  | 'tag_add'
  | 'tag_remove'
  | 'enable'
  | 'disable'

export interface BulkUserActionRequest {
  action: BulkUserActionType
  user_ids?: number[]
  filter?: UserQueryFilter
  segment_id?: number
  quota?: number
  group?: string
  tag?: string
}

export interface BulkUserActionResult {
  targets: number
  applied: number
}
