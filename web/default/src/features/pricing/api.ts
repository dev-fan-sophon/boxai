/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
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
