import { useMutation, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { toast } from 'sonner'

import { DEFAULT_LOGO } from '@/lib/constants'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { updateSystemOption } from '../api'
import type { UpdateOptionRequest } from '../types'

// Configuration keys that require status refresh
const STATUS_RELATED_KEYS = new Set([
  'branding.favicon_url',
  'branding.primary_color',
  'SystemName',
  'Logo',
  'Footer',
  'HeaderNavModules',
  'SidebarModulesAdmin',
  'Notice',
  'LogConsumeEnabled',
  'QuotaPerUnit',
  'USDExchangeRate',
  'DisplayInCurrencyEnabled',
  'DisplayTokenStatEnabled',
  'general_setting.quota_display_type',
  'general_setting.custom_currency_symbol',
  'general_setting.custom_currency_exchange_rate',
  'general_setting.business_timezone',
])

export type UpdateOptionsResult = {
  success: boolean
  message: string
  applied: UpdateOptionRequest[]
}

/**
 * Saves one or more options as a single user-facing action.
 *
 * The backend only accepts one option per request, so a save that touches
 * several keys still issues several requests. Feedback is emitted once for the
 * whole batch, not once per request.
 */
export function useUpdateOption() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      requests: UpdateOptionRequest[]
    ): Promise<UpdateOptionsResult> => {
      const applied: UpdateOptionRequest[] = []

      for (const request of requests) {
        const data = await updateSystemOption(request)
        if (!data.success) {
          return { success: false, message: data.message, applied }
        }
        applied.push(request)
      }

      return { success: true, message: '', applied }
    },
    onSuccess: (result) => {
      if (result.applied.length === 0) return

      const setSystemConfig = useSystemConfigStore.getState().setConfig
      let shouldRefreshStatus = false

      for (const request of result.applied) {
        const value = String(request.value)
        switch (request.key) {
          case 'SystemName':
            setSystemConfig({ systemName: value })
            break
          case 'Logo':
            setSystemConfig({ logo: value || DEFAULT_LOGO })
            break
          case 'Footer':
            setSystemConfig({ footerHtml: value })
            break
          case 'branding.favicon_url':
            setSystemConfig({ faviconUrl: value })
            break
          case 'branding.primary_color':
            setSystemConfig({ primaryColor: value })
            break
          case 'general_setting.business_timezone':
            setSystemConfig({ businessTimezone: value })
            break
        }

        if (STATUS_RELATED_KEYS.has(request.key)) {
          shouldRefreshStatus = true
        }
      }

      // Always refresh system-options
      queryClient.invalidateQueries({ queryKey: ['system-options'] })

      // If updating frontend-display-related config, also refresh status
      if (shouldRefreshStatus) {
        queryClient.invalidateQueries({ queryKey: ['status'] })
        try {
          window.localStorage.removeItem('status')
        } catch {
          /* empty */
        }
      }

      if (result.success) {
        toast.success(i18next.t('Setting updated successfully'))
      }
    },
    // Failures are already reported by the shared axios interceptor. Keeping an
    // explicit handler prevents the global mutation handler from adding a
    // second toast for the same failure.
    onError: () => {},
  })
}
