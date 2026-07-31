import { api } from '@/lib/api'

import type { HomePageContentResponse, HomeStatsResponse } from './types'

export async function getHomePageContent(): Promise<HomePageContentResponse> {
  const response = await api.get('/api/home_page_content')
  return response.data
}

export async function getHomeStats(): Promise<HomeStatsResponse> {
  const response = await api.get('/api/home/stats')
  return response.data
}
