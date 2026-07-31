import type { PermissionCatalog } from '@/lib/admin-permissions'
import { api } from '@/lib/api'

import type {
  User,
  GetUsersParams,
  GetUsersResponse,
  SearchUsersParams,
  UserFormData,
  ManageUserAction,
  ManageUserQuotaPayload,
  ApiResponse,
  AcquisitionAnalytics,
  AdminUserQueryRequest,
  AdminUserQueryResult,
  BulkUserActionRequest,
  BulkUserActionResult,
  RevenueAnalytics,
  UserCampaign,
  UserFunnelStage,
  UserGrowthOverview,
  UserProfile,
  UserQueryFilter,
  UserRetentionCohort,
  UserSegment,
  UserTagCount,
} from './types'

export interface AnalyticsTimeRange {
  start_timestamp: number
  end_timestamp: number
}

// ============================================================================
// User Management APIs
// ============================================================================

/**
 * Get paginated users list
 */
export async function getUsers(
  params: GetUsersParams = {}
): Promise<GetUsersResponse> {
  const { p = 1, page_size = 10, sort_by, sort_order } = params
  const res = await api.get('/api/user/', {
    params: {
      p,
      page_size,
      sort_by,
      sort_order,
    },
  })
  return res.data
}

/**
 * Search users by keyword or group
 */
export async function searchUsers(
  params: SearchUsersParams
): Promise<GetUsersResponse> {
  const {
    keyword = '',
    group = '',
    role = '',
    status = '',
    p = 1,
    page_size = 10,
    sort_by,
    sort_order,
  } = params
  const queryParams = new URLSearchParams()
  queryParams.set('keyword', keyword)
  queryParams.set('group', group)
  if (role) queryParams.set('role', role)
  if (status) queryParams.set('status', status)
  queryParams.set('p', String(p))
  queryParams.set('page_size', String(page_size))
  if (sort_by) queryParams.set('sort_by', sort_by)
  if (sort_order) queryParams.set('sort_order', sort_order)
  const res = await api.get(`/api/user/search?${queryParams.toString()}`)
  return res.data
}

/**
 * Get single user by ID
 */
export async function getUser(id: number): Promise<ApiResponse<User>> {
  const res = await api.get(`/api/user/${id}`)
  return res.data
}

/**
 * Create a new user
 */
export async function createUser(
  data: UserFormData
): Promise<ApiResponse<User>> {
  const res = await api.post('/api/user/', data)
  return res.data
}

/**
 * Update an existing user
 */
export async function updateUser(
  data: UserFormData & { id: number }
): Promise<ApiResponse<Partial<User>>> {
  const res = await api.put('/api/user/', data)
  return res.data
}

/**
 * Delete a single user (hard delete)
 */
export async function deleteUser(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/user/${id}/`)
  return res.data
}

/**
 * Manage user (promote, demote, enable, disable, delete)
 */
export async function manageUser(
  id: number,
  action: ManageUserAction
): Promise<ApiResponse<Partial<User>>> {
  const res = await api.post('/api/user/manage', { id, action })
  return res.data
}

/**
 * Adjust user quota atomically (add/subtract/override)
 */
export async function adjustUserQuota(
  payload: ManageUserQuotaPayload
): Promise<ApiResponse<Partial<User>>> {
  const res = await api.post('/api/user/manage', payload)
  return res.data
}

/**
 * Reset user's Passkey registration
 */
export async function resetUserPasskey(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/user/${id}/reset_passkey`)
  return res.data
}

/**
 * Reset user's Two-Factor Authentication setup
 */
export async function resetUserTwoFA(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/user/${id}/2fa`)
  return res.data
}

/**
 * Get all available groups
 */
export async function getGroups(): Promise<ApiResponse<string[]>> {
  const res = await api.get('/api/group/')
  return res.data
}

/**
 * Get the permission catalog (resources, actions, and role baselines).
 * Source of truth lives in the backend authz package.
 */
export async function getPermissionCatalog(): Promise<PermissionCatalog> {
  const res = await api.get('/api/authz/catalog')
  return {
    resources: res.data?.data?.resources ?? [],
    roles: res.data?.data?.roles ?? [],
  }
}

// ============================================================================
// Admin Binding Management APIs
// ============================================================================

export interface OAuthBinding {
  provider_id: string
  provider_name: string
  user_id?: number
  external_id?: string
}

/**
 * Get user's custom OAuth bindings (admin)
 */
export async function getUserOAuthBindings(
  userId: number
): Promise<ApiResponse<OAuthBinding[]>> {
  const res = await api.get(`/api/user/${userId}/oauth/bindings`)
  return res.data
}

/**
 * Clear a user's built-in binding (admin)
 */
export async function adminClearUserBinding(
  userId: number,
  bindingType: string
): Promise<ApiResponse> {
  const res = await api.delete(`/api/user/${userId}/bindings/${bindingType}`)
  return res.data
}

/**
 * Unbind custom OAuth for a user (admin)
 */
export async function adminUnbindCustomOAuth(
  userId: number,
  providerId: string
): Promise<ApiResponse> {
  const res = await api.delete(
    `/api/user/${userId}/oauth/bindings/${providerId}`
  )
  return res.data
}

// ============================================================================
// Operations Console: growth analytics
// ============================================================================

export async function getUserGrowthOverview(
  range: AnalyticsTimeRange
): Promise<ApiResponse<UserGrowthOverview>> {
  const res = await api.get('/api/admin/users/stats/overview', {
    params: range,
  })
  return res.data
}

export async function getUserFunnel(
  range: AnalyticsTimeRange
): Promise<ApiResponse<UserFunnelStage[]>> {
  const res = await api.get('/api/admin/users/stats/funnel', { params: range })
  return res.data
}

export async function getUserRetention(
  range: AnalyticsTimeRange,
  offsets = 14
): Promise<ApiResponse<UserRetentionCohort[]>> {
  const res = await api.get('/api/admin/users/stats/retention', {
    params: { ...range, offsets },
  })
  return res.data
}

export async function getRevenueAnalytics(
  range: AnalyticsTimeRange
): Promise<ApiResponse<RevenueAnalytics>> {
  const res = await api.get('/api/admin/users/stats/revenue', { params: range })
  return res.data
}

export async function getAcquisitionAnalytics(
  range: AnalyticsTimeRange
): Promise<ApiResponse<AcquisitionAnalytics>> {
  const res = await api.get('/api/admin/users/stats/acquisition', {
    params: range,
  })
  return res.data
}

// ============================================================================
// Operations Console: directory, profile, bulk actions
// ============================================================================

export async function queryAdminUsers(
  request: AdminUserQueryRequest
): Promise<ApiResponse<AdminUserQueryResult>> {
  const res = await api.post('/api/admin/users/query', request)
  return res.data
}

export async function getAdminUserProfile(
  id: number
): Promise<ApiResponse<UserProfile>> {
  const res = await api.get(`/api/admin/users/${id}/profile`)
  return res.data
}

export async function getUserTags(): Promise<ApiResponse<UserTagCount[]>> {
  const res = await api.get('/api/admin/users/tags')
  return res.data
}

export async function runBulkUserAction(
  request: BulkUserActionRequest
): Promise<ApiResponse<BulkUserActionResult>> {
  const res = await api.post('/api/admin/users/bulk', request)
  return res.data
}

export async function exportAdminUsers(
  request: AdminUserQueryRequest
): Promise<Blob> {
  const res = await api.post('/api/admin/users/export', request, {
    responseType: 'blob',
  })
  return res.data as Blob
}

// ============================================================================
// Operations Console: segments and campaigns
// ============================================================================

export async function listUserSegments(): Promise<ApiResponse<UserSegment[]>> {
  const res = await api.get('/api/admin/segments')
  return res.data
}

export async function createUserSegment(payload: {
  name: string
  description: string
  filter: UserQueryFilter
}): Promise<ApiResponse<UserSegment>> {
  const res = await api.post('/api/admin/segments', payload)
  return res.data
}

export async function updateUserSegment(
  id: number,
  payload: { name: string; description: string; filter: UserQueryFilter }
): Promise<ApiResponse<UserSegment>> {
  const res = await api.put(`/api/admin/segments/${id}`, payload)
  return res.data
}

export async function deleteUserSegment(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/admin/segments/${id}`)
  return res.data
}

export async function previewUserSegment(
  filter: UserQueryFilter
): Promise<ApiResponse<{ total: number }>> {
  const res = await api.post('/api/admin/segments/preview', { filter })
  return res.data
}

export async function listUserCampaigns(): Promise<
  ApiResponse<UserCampaign[]>
> {
  const res = await api.get('/api/admin/segments/campaigns')
  return res.data
}

export async function sendUserCampaign(payload: {
  name: string
  segment_id?: number
  filter?: UserQueryFilter
  user_ids?: number[]
  subject: string
  content: string
}): Promise<ApiResponse<UserCampaign>> {
  const res = await api.post('/api/admin/segments/campaigns', payload)
  return res.data
}
