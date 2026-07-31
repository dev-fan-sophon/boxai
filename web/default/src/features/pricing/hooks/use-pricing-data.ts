import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getPlaygroundCatalog, getPricing } from '../api'

type PricingDataSource = 'pricing' | 'playground'

export function usePricingData(source: PricingDataSource = 'pricing') {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['pricing', source],
    queryFn: source === 'playground' ? getPlaygroundCatalog : getPricing,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: source === 'playground' ? 'always' : true,
    refetchOnWindowFocus: source === 'playground' ? 'always' : true,
  })

  const models = useMemo(() => {
    // Real /api/pricing payload only — empty list when the site has no models.
    const catalog = Array.isArray(data?.data) ? data.data : []
    if (!catalog.length) return []

    const vendors = Array.isArray(data?.vendors) ? data.vendors : []
    const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]))

    return catalog.map((model) => {
      const vendor = model.vendor_id
        ? vendorMap.get(model.vendor_id)
        : undefined
      return {
        ...model,
        key: model.model_name,
        vendor_name: vendor?.name ?? model.vendor_name,
        vendor_icon: vendor?.icon ?? model.vendor_icon,
        vendor_description: vendor?.description ?? model.vendor_description,
        group_ratio: data?.group_ratio ?? {},
      }
    })
  }, [data])

  return {
    models,
    vendors: Array.isArray(data?.vendors) ? data.vendors : [],
    groupRatio: data?.group_ratio ?? {},
    usableGroup: data?.usable_group ?? {},
    endpointMap: data?.supported_endpoint ?? {},
    integrationProfiles: Array.isArray(data?.integration_profiles)
      ? data.integration_profiles
      : [],
    isLegacyPlaygroundCatalog: data?.legacy_playground_catalog === true,
    autoGroups: Array.isArray(data?.auto_groups) ? data.auto_groups : [],
    isLoading,
    error,
    refetch,
  }
}
