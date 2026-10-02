import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { usePricingData } from '@/features/pricing/hooks/use-pricing-data'
import { canTryInPlayground } from '@/features/pricing/lib/playground-eligibility'
import type { PricingModel } from '@/features/pricing/types'
import { useAuthStore } from '@/stores/auth-store'
import { useCreateStore } from '@/stores/create-store'
import { usePlaygroundStore } from '@/stores/playground-store'

import { STORAGE_KEYS } from '../constants'
import { useArtifactPreviewStore } from '../lib/artifact-preview-store'
import { getModelModality } from '../lib/studio/model-modality'
import type { PlaygroundConfig, StudioModality } from '../types'
import { usePlaygroundOptions } from './use-playground-options'
import { useSessionCloudSync } from './use-session-cloud-sync'

type WorkspaceSurface = 'playground' | 'create'

/**
 * Everything a model workspace needs before it can render: the account
 * scope (local sessions belong to one signed-in identity), cloud sync, the
 * model catalog for the surface, and the user's model/group options.
 *
 * Chat (`/playground`) and the media studio (`/create/*`) are separate pages
 * that share the session store, so both mount this once. The automatic model
 * fallback only picks models of the active modality, so opening chat never
 * lands on a video engine and vice versa. The modality is read from the
 * store, not the route: pages switch it in a layout effect, and deriving
 * both the filter and the current model from one snapshot keeps a stale
 * render from overwriting the restored session model.
 */
export function useWorkspaceBootstrap(input: { surface: WorkspaceSurface }) {
  const user = useAuthStore((state) => state.auth.user)
  const isAuthenticated = Boolean(user)
  const currentUserId = user?.id ?? null
  const previousUserIdRef = useRef<number | null | undefined>(undefined)
  const [scopedUserId, setScopedUserId] = useState<number | null | undefined>(
    undefined
  )
  const [signInDialogOpen, setSignInDialogOpen] = useState(false)
  const resetAccountData = usePlaygroundStore((state) => state.resetAccountData)
  const config = usePlaygroundStore((state) => state.config)
  const setModels = usePlaygroundStore((state) => state.setModels)
  const setGroups = usePlaygroundStore((state) => state.setGroups)
  const patchConfig = usePlaygroundStore((state) => state.updateConfig)

  useLayoutEffect(() => {
    let previousOwner: string | null = null
    try {
      previousOwner = window.localStorage.getItem(STORAGE_KEYS.ACCOUNT_OWNER)
    } catch {
      // Storage may be unavailable; the in-memory identity still scopes data.
    }
    const currentOwner = currentUserId === null ? null : String(currentUserId)
    const identityChanged =
      previousUserIdRef.current !== undefined &&
      previousUserIdRef.current !== currentUserId
    const persistedOwnerChanged =
      currentOwner === null
        ? previousOwner !== null
        : previousOwner !== currentOwner
    if (identityChanged || persistedOwnerChanged) {
      resetAccountData()
      useCreateStore.getState().resetCreateData()
      useArtifactPreviewStore.getState().close()
    }
    try {
      if (currentOwner !== null) {
        window.localStorage.setItem(STORAGE_KEYS.ACCOUNT_OWNER, currentOwner)
      } else if (previousOwner !== null) {
        window.localStorage.removeItem(STORAGE_KEYS.ACCOUNT_OWNER)
      }
    } catch {
      // Storage may be unavailable.
    }
    previousUserIdRef.current = currentUserId
    setScopedUserId(currentUserId)
  }, [currentUserId, resetAccountData])

  const accountScopeReady = scopedUserId === currentUserId
  useSessionCloudSync(accountScopeReady ? user?.id : undefined)

  const pricing = usePricingData(input.surface)
  const catalogModels = useMemo(() => {
    // Strict mode only when at least one model has an explicit playground
    // integration. Otherwise fall back to the full catalog so production
    // sites that have not configured integrations yet still work.
    if (pricing.isLegacyPlaygroundCatalog) return pricing.models
    const eligible = pricing.models.filter(canTryInPlayground)
    return eligible.length > 0 ? eligible : pricing.models
  }, [pricing.isLegacyPlaygroundCatalog, pricing.models])

  const modalityByModel = useMemo(() => {
    const map = new Map<string, StudioModality>()
    for (const model of catalogModels) {
      map.set(model.model_name, getModelModality(model))
    }
    return map
  }, [catalogModels])

  const activeModality = usePlaygroundStore((state) => state.activeModality)
  const modelFilter = useCallback(
    (modelName: string) => {
      const modality =
        modalityByModel.get(modelName) ??
        getModelModality({ model_name: modelName })
      return modality === activeModality
    },
    [activeModality, modalityByModel]
  )

  const publicModels = useMemo(
    () =>
      catalogModels.map((model) => ({
        label: model.model_name,
        value: model.model_name,
        reasoningEfforts: model.reasoning_efforts,
      })),
    [catalogModels]
  )
  const publicGroups = useMemo(
    () =>
      Object.entries(pricing.usableGroup).map(([value, group]) => ({
        value,
        label: value,
        desc: typeof group === 'string' ? group : group.desc,
        ratio:
          typeof group === 'string' ? pricing.groupRatio[value] : group.ratio,
      })),
    [pricing.groupRatio, pricing.usableGroup]
  )
  const updateConfig = useCallback(
    <K extends keyof PlaygroundConfig>(key: K, value: PlaygroundConfig[K]) => {
      patchConfig({ [key]: value })
    },
    [patchConfig]
  )
  const { isLoadingModels } = usePlaygroundOptions({
    isAuthenticated,
    publicGroups,
    publicModels,
    currentGroup: config.group,
    currentModel: config.model,
    setGroups,
    setModels,
    updateConfig,
    modelFilter,
  })

  const requireAuthentication = useCallback((): boolean => {
    if (user) return true
    setSignInDialogOpen(true)
    return false
  }, [user])

  const findCatalogModel = useCallback(
    (modelName: string): PricingModel | undefined =>
      catalogModels.find((model) => model.model_name === modelName),
    [catalogModels]
  )

  return {
    user,
    isAuthenticated,
    scopedUserId,
    accountScopeReady,
    pricing,
    catalogModels,
    findCatalogModel,
    modelFilter,
    isLoadingModels,
    requireAuthentication,
    signInDialogOpen,
    setSignInDialogOpen,
  }
}
