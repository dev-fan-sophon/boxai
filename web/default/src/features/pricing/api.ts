import { isAxiosError } from 'axios'

import { api } from '@/lib/api'

import type { IntegrationProfile, PricingData } from './types'

// ----------------------------------------------------------------------------
// Pricing APIs
// ----------------------------------------------------------------------------

// Get model pricing data
export async function getPricing(): Promise<PricingData> {
  const res = await api.get('/api/pricing')
  return res.data
}

export async function getPlaygroundCatalog(
  path:
    | '/api/playground/catalog'
    | '/api/create/catalog' = '/api/playground/catalog'
): Promise<PricingData> {
  try {
    // A 404 means an older backend without this route; fall back quietly.
    const res = await api.get(path, {
      skipErrorHandler: true,
    } as Record<string, unknown>)
    return res.data
  } catch (error) {
    if (!isAxiosError(error) || error.response?.status !== 404) throw error
    const pricing = await getPricing()
    return { ...pricing, legacy_playground_catalog: true }
  }
}

export async function getIntegrationProfiles(): Promise<IntegrationProfile[]> {
  const res = await api.get('/api/integration-profiles')
  return res.data.data ?? []
}
