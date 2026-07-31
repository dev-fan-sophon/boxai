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

export async function getPlaygroundCatalog(): Promise<PricingData> {
  try {
    const res = await api.get('/api/playground/catalog')
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
