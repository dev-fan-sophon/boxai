import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { useCallback } from 'react'
import { toast } from 'sonner'

import { getUserProfile, updateUserProfile, updateUserSettings } from '../api'
import { PROFILE_QUERY_KEYS } from '../constants'
import type { UpdateUserRequest, UpdateUserSettingsRequest } from '../types'

// ============================================================================
// Profile Hook
// ============================================================================

export function useProfile() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: PROFILE_QUERY_KEYS.self,
    queryFn: async () => {
      const response = await getUserProfile()
      if (!response.success || !response.data) {
        throw new Error(response.message || i18next.t('Failed to load profile'))
      }
      return response.data
    },
    retry: false,
  })

  const refetch = query.refetch
  const fetchProfile = useCallback(async () => {
    await refetch()
  }, [refetch])

  // Background refresh: keeps the current profile on screen while refetching.
  const refreshProfile = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEYS.self })
  }, [queryClient])

  const updateProfileMutation = useMutation({
    mutationFn: async (data: UpdateUserRequest) => {
      const response = await updateUserProfile(data)
      if (!response.success) {
        toast.error(response.message || i18next.t('Failed to update profile'))
        return false
      }
      toast.success(i18next.t('Profile updated successfully'))
      return true
    },
    onSuccess: async (updated) => {
      if (updated) await refreshProfile()
    },
  })

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: UpdateUserSettingsRequest) => {
      const response = await updateUserSettings(data)
      if (!response.success) {
        toast.error(response.message || i18next.t('Failed to update settings'))
        return false
      }
      toast.success(i18next.t('Settings updated successfully'))
      return true
    },
    onSuccess: async (updated) => {
      if (updated) await refreshProfile()
    },
  })

  // Network failures are toasted by the global mutation onError
  // (handleServerError); callers only need the boolean outcome.
  const mutateProfile = updateProfileMutation.mutateAsync
  const updateProfile = useCallback(
    (data: UpdateUserRequest): Promise<boolean> =>
      mutateProfile(data).catch(() => false),
    [mutateProfile]
  )

  const mutateSettings = updateSettingsMutation.mutateAsync
  const updateSettings = useCallback(
    (data: UpdateUserSettingsRequest): Promise<boolean> =>
      mutateSettings(data).catch(() => false),
    [mutateSettings]
  )

  return {
    profile: query.data ?? null,
    loading: query.isPending,
    isError: query.isError,
    updating:
      updateProfileMutation.isPending || updateSettingsMutation.isPending,
    fetchProfile,
    refreshProfile,
    refetch,
    updateProfile,
    updateSettings,
  }
}
