export interface HomePageContentResponse {
  success: boolean
  message?: string
  data?: string
}

export interface HomePageContentResult {
  content: string
  isLoaded: boolean
  isUrl: boolean
}

export type HomeStatsVendor = {
  name: string
  icon: string
}

export type HomeStatsModel = {
  model_name: string
  vendor: string
  vendor_icon: string
  total_tokens: number
  share: number
}

export type HomeStatsPoint = {
  ts: number
  label: string
  tokens: number
}

export type HomeStats = {
  period_days: number
  available_models: number
  active_vendors: number
  endpoint_types: number
  request_count: number | null
  total_tokens: number
  success_rate: number | null
  avg_latency_ms: number | null
  vendors: HomeStatsVendor[]
  top_models: HomeStatsModel[]
  trend: HomeStatsPoint[]
  updated_at: number
}

export type HomeStatsResponse = {
  success: boolean
  message?: string
  data: HomeStats
}
