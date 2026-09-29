import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import i18next from 'i18next'
import { useState, useCallback } from 'react'
import { toast } from 'sonner'

import { useIsAdmin } from '@/hooks/use-admin'

import {
  getUserBillingHistory,
  getAllBillingHistory,
  completeOrder,
  isApiSuccess,
} from '../api'
import { BILLING_QUERY_KEYS } from '../constants'
import type { TopupRecord } from '../types'

// ============================================================================
// Billing History Hook
// ============================================================================

interface UseBillingHistoryOptions {
  /** Initial page number */
  initialPage?: number
  /** Initial page size */
  initialPageSize?: number
}

const EMPTY_RECORDS: TopupRecord[] = []

// Pending bank transfers change state when an admin reviews them, so the
// visible list is polled while the tab is in the foreground.
const HISTORY_POLL_INTERVAL_MS = 30_000

export function useBillingHistory(options: UseBillingHistoryOptions = {}) {
  const { initialPage = 1, initialPageSize = 10 } = options
  const isAdmin = useIsAdmin()
  const queryClient = useQueryClient()

  const [page, setPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [keyword, setKeyword] = useState('')

  const query = useQuery({
    queryKey: [
      ...BILLING_QUERY_KEYS.history,
      { isAdmin, page, pageSize, keyword },
    ],
    queryFn: async () => {
      const response = isAdmin
        ? await getAllBillingHistory(page, pageSize, keyword)
        : await getUserBillingHistory(page, pageSize, keyword)
      if (!isApiSuccess(response) || !response.data) {
        throw new Error(
          response.message || i18next.t('Failed to load billing history')
        )
      }
      return {
        items: response.data.items || [],
        total: response.data.total || 0,
      }
    },
    placeholderData: keepPreviousData,
    refetchInterval: HISTORY_POLL_INTERVAL_MS,
    retry: false,
  })

  const completeMutation = useMutation({
    mutationFn: async (tradeNo: string) => {
      const response = await completeOrder({ trade_no: tradeNo })
      if (!isApiSuccess(response)) {
        toast.error(response.message || i18next.t('Failed to complete order'))
        return false
      }
      toast.success(i18next.t('Order completed successfully'))
      return true
    },
    onSuccess: async (completed) => {
      if (!completed) return
      await queryClient.invalidateQueries({
        queryKey: BILLING_QUERY_KEYS.history,
      })
    },
  })

  /**
   * Complete a pending order (admin only)
   */
  const mutateComplete = completeMutation.mutateAsync
  const handleCompleteOrder = useCallback(
    async (tradeNo: string) => {
      if (!isAdmin) {
        toast.error(i18next.t('Admin access required'))
        return false
      }
      // Network failures are toasted by the global mutation onError.
      return mutateComplete(tradeNo).catch(() => false)
    },
    [isAdmin, mutateComplete]
  )

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize)
    setPage(1) // Reset to first page when changing page size
  }, [])

  const handleSearch = useCallback((newKeyword: string) => {
    setKeyword(newKeyword)
    setPage(1) // Reset to first page when searching
  }, [])

  const refetch = query.refetch
  const refresh = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    records: query.data?.items ?? EMPTY_RECORDS,
    total: query.data?.total ?? 0,
    page,
    pageSize,
    keyword,
    loading: query.isPending,
    isError: query.isError,
    hasData: query.data !== undefined,
    completing: completeMutation.isPending,
    isAdmin,
    handlePageChange,
    handlePageSizeChange,
    handleSearch,
    handleCompleteOrder,
    refresh,
  }
}
