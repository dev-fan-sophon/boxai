export type GroupModelStatus =
  | 'healthy'
  | 'slow'
  | 'down'
  | 'observing'
  | string

export type GroupStatusSeriesPoint = {
  ts: number
  success_rate: number | null
  request_count: number
}

export type GroupStatusModel = {
  model: string
  status: GroupModelStatus
  success_rate: number | null
  sample_window: number
  series_window: number
  bucket_seconds: number
  request_count: number
  series: GroupStatusSeriesPoint[]
}

export type GroupStatusGroup = {
  group: string
  status: GroupModelStatus
  request_count: number
  models: GroupStatusModel[]
}

export type GroupStatusResponse = {
  success: boolean
  message?: string
  data: GroupStatusGroup[]
}
