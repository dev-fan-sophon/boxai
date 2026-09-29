import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { useCallback } from 'react'
import { toast } from 'sonner'

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { getSelf } from '@/lib/api'

import { getAffiliateCode, transferAffiliateQuota } from '../api'
import { BILLING_QUERY_KEYS } from '../constants'
import { generateAffiliateLink } from '../lib'

// ============================================================================
// Affiliate Hook
// ============================================================================

export function useAffiliate() {
  const queryClient = useQueryClient()
  const { copyToClipboard } = useCopyToClipboard()

  const query = useQuery({
    queryKey: BILLING_QUERY_KEYS.affiliateCode,
    queryFn: async () => {
      const response = await getAffiliateCode()
      if (!response.success) {
        throw new Error(
          response.message || i18next.t('Failed to load referral link')
        )
      }
      return response.data || ''
    },
    retry: false,
  })

  const affiliateCode = query.data ?? ''
  const affiliateLink = affiliateCode
    ? generateAffiliateLink(affiliateCode)
    : ''

  const transferMutation = useMutation({
    mutationFn: async (quota: number) => {
      const response = await transferAffiliateQuota({ quota })
      if (!response.success) {
        toast.error(response.message || i18next.t('Transfer failed'))
        return false
      }
      toast.success(response.message || i18next.t('Transfer successful'))
      return true
    },
    onSuccess: async (transferred) => {
      if (!transferred) return
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEYS.wallet }),
        getSelf(),
      ])
    },
  })

  const copyAffiliateLink = useCallback(() => {
    copyToClipboard(affiliateLink)
  }, [affiliateLink, copyToClipboard])

  // Network failures are reported by the global mutation onError
  // (handleServerError); callers only need the boolean outcome.
  const mutateTransfer = transferMutation.mutateAsync
  const transferQuota = useCallback(
    (quota: number): Promise<boolean> =>
      mutateTransfer(quota).catch(() => false),
    [mutateTransfer]
  )

  return {
    affiliateCode,
    affiliateLink,
    loading: query.isPending,
    isError: query.isError,
    transferring: transferMutation.isPending,
    copyAffiliateLink,
    transferQuota,
    refetch: query.refetch,
  }
}
