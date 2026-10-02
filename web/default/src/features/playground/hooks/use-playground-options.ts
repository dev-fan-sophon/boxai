import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { getUserGroups, getUserModels } from '../api'
import {
  applyModelMetadata,
  getGroupFallback,
  getModelFallback,
  getOptionLoadErrorMessage,
  shouldClearModelForGroup,
} from '../lib'
import type { GroupOption, ModelOption, PlaygroundConfig } from '../types'

type UsePlaygroundOptionsParams = {
  isAuthenticated: boolean
  publicGroups: GroupOption[]
  publicModels: ModelOption[]
  currentGroup: string
  currentModel: string
  setGroups: (groups: GroupOption[]) => void
  setModels: (models: ModelOption[]) => void
  updateConfig: <K extends keyof PlaygroundConfig>(
    key: K,
    value: PlaygroundConfig[K]
  ) => void
  /**
   * Models the current surface may fall back to. Chat and the media studio
   * share one model list; without this a chat page whose saved model
   * disappeared would fall back to whatever model sorts first, video included.
   */
  modelFilter?: (modelName: string) => boolean
}

export function usePlaygroundOptions({
  isAuthenticated,
  publicGroups,
  publicModels,
  currentGroup,
  currentModel,
  setGroups,
  setModels,
  updateConfig,
  modelFilter,
}: UsePlaygroundOptionsParams) {
  const { t } = useTranslation()

  const {
    data: modelsData,
    error: modelsError,
    isError: isModelsError,
    isLoading: isLoadingModels,
  } = useQuery({
    queryKey: ['playground-models', currentGroup],
    queryFn: () => getUserModels(currentGroup),
    enabled: isAuthenticated && currentGroup !== '',
  })

  const {
    data: groupsData,
    error: groupsError,
    isError: isGroupsError,
  } = useQuery({
    queryKey: ['playground-groups'],
    queryFn: getUserGroups,
    enabled: isAuthenticated,
  })

  useEffect(() => {
    if (!isModelsError) return

    toast.error(
      getOptionLoadErrorMessage(
        modelsError,
        t('Failed to load playground models')
      )
    )
  }, [isModelsError, modelsError, t])

  useEffect(() => {
    if (!isGroupsError) return

    toast.error(
      getOptionLoadErrorMessage(
        groupsError,
        t('Failed to load playground groups')
      )
    )
  }, [isGroupsError, groupsError, t])

  useEffect(() => {
    if (isAuthenticated) return

    setModels(publicModels)
    const candidates = modelFilter
      ? publicModels.filter((model) => modelFilter(model.value))
      : publicModels
    const modelFallback = getModelFallback(candidates, currentModel)
    if (modelFallback) {
      updateConfig('model', modelFallback)
    } else if (
      candidates.length > 0 &&
      shouldClearModelForGroup(candidates, currentModel)
    ) {
      updateConfig('model', '')
    }

    setGroups(publicGroups)
    const groupFallback = getGroupFallback(publicGroups, currentGroup)
    if (groupFallback) updateConfig('group', groupFallback)
  }, [
    currentGroup,
    currentModel,
    isAuthenticated,
    modelFilter,
    publicGroups,
    publicModels,
    setGroups,
    setModels,
    updateConfig,
  ])

  useEffect(() => {
    if (!isAuthenticated) return
    if (!modelsData) return

    const availableModels = applyModelMetadata(modelsData, publicModels)
    setModels(availableModels)
    const candidates = modelFilter
      ? availableModels.filter((model) => modelFilter(model.value))
      : availableModels
    const fallback = getModelFallback(candidates, currentModel)

    if (fallback) {
      updateConfig('model', fallback)
      return
    }

    if (shouldClearModelForGroup(candidates, currentModel)) {
      updateConfig('model', '')
    }
  }, [
    isAuthenticated,
    modelsData,
    currentModel,
    modelFilter,
    publicModels,
    setModels,
    updateConfig,
  ])

  useEffect(() => {
    if (!isAuthenticated || !groupsData) return

    setGroups(groupsData)
    const fallback = getGroupFallback(groupsData, currentGroup)

    if (fallback) {
      updateConfig('group', fallback)
    }
  }, [isAuthenticated, groupsData, currentGroup, setGroups, updateConfig])

  return {
    isLoadingModels: isAuthenticated && isLoadingModels,
  }
}
