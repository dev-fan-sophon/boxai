import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import type { OnChangeFn, SortingState } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DISABLED_ROW_DESKTOP,
  DISABLED_ROW_MOBILE,
  DataTablePage,
  useDataTable,
} from '@/components/data-table'
import { useSmDown } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'

import { queryAdminUsers } from '../api'
import {
  USER_STATUS,
  getUserStatusOptions,
  getUserRoleOptions,
  isUserDeleted,
} from '../constants'
import { compactFilter } from '../lib/ops'
import type {
  AdminUserRow,
  AdminUserSortBy,
  UserQueryFilter,
  UserSortOrder,
} from '../types'
import { DataTableBulkActions } from './data-table-bulk-actions'
import { useUsersColumns } from './users-columns'
import { useUsers } from './users-provider'

const route = getRouteApi('/_authenticated/users/$section')

const USER_SORTABLE_COLUMNS = new Set<AdminUserSortBy>([
  'id',
  'username',
  'quota',
  'used_quota',
  'created_at',
  'last_login_at',
  'last_active_at',
  'topup_money',
  'topup_count',
  'quota_30',
  'active_days',
])

function isDisabledUserRow(user: AdminUserRow) {
  return isUserDeleted(user) || user.status === USER_STATUS.DISABLED
}

export function UsersTable() {
  const { t } = useTranslation()
  const columns = useUsersColumns()
  const { refreshTrigger, advancedFilter } = useUsers()
  const isMobile = useSmDown()
  const [sorting, setSorting] = useState<SortingState>([])

  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: isMobile ? 10 : 20 },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [
      { columnId: 'status', searchKey: 'status', type: 'array' },
      { columnId: 'role', searchKey: 'role', type: 'array' },
      { columnId: 'group', searchKey: 'group', type: 'string' },
    ],
  })
  const statusFilter =
    (
      columnFilters.find((filter) => filter.id === 'status')?.value as
        | string[]
        | undefined
    )?.[0] ?? ''
  const roleFilter =
    (
      columnFilters.find((filter) => filter.id === 'role')?.value as
        | string[]
        | undefined
    )?.[0] ?? ''
  const groupFilter =
    (columnFilters.find((filter) => filter.id === 'group')?.value as string) ??
    ''

  const sortParams = useMemo(() => {
    const activeSort = sorting[0]
    if (
      !activeSort ||
      !USER_SORTABLE_COLUMNS.has(activeSort.id as AdminUserSortBy)
    ) {
      return {}
    }

    return {
      sort_by: activeSort.id as AdminUserSortBy,
      sort_order: (activeSort.desc ? 'desc' : 'asc') as UserSortOrder,
    }
  }, [sorting])

  // Toolbar filters live in the URL, the audience sheet keeps richer predicates
  // in memory; the query endpoint takes a single merged filter object.
  const requestFilter: UserQueryFilter = useMemo(
    () =>
      compactFilter({
        ...advancedFilter,
        keyword: globalFilter || advancedFilter.keyword,
        group: groupFilter || advancedFilter.group,
        status: statusFilter ? Number(statusFilter) : advancedFilter.status,
        role: roleFilter ? Number(roleFilter) : advancedFilter.role,
      }),
    [advancedFilter, globalFilter, groupFilter, statusFilter, roleFilter]
  )

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting(updater)
    if (pagination.pageIndex > 0) {
      onPaginationChange({ ...pagination, pageIndex: 0 })
    }
  }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'users',
      pagination.pageIndex + 1,
      pagination.pageSize,
      requestFilter,
      sortParams,
      refreshTrigger,
    ],
    queryFn: async () => {
      const result = await queryAdminUsers({
        filter: requestFilter,
        page: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        ...sortParams,
      })

      if (!result.success) {
        toast.error(result.message || 'Failed to load users')
        return { items: [] as AdminUserRow[], total: 0 }
      }

      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const users = data?.items ?? []

  const { table } = useDataTable({
    data: users,
    columns,
    enableRowSelection: true,
    columnFilters,
    globalFilter,
    pagination,
    sorting,
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    onSortingChange: handleSortingChange,
    manualPagination: true,
    manualFiltering: true,
    manualSorting: true,
    totalCount: data?.total ?? 0,
    ensurePageInRange,
  })

  return (
    <DataTablePage
      enableCardView
      defaultViewMode='card'
      viewModeStorageKey='users:view-mode:v1'
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No Users Found')}
      emptyDescription={t(
        'No users available. Try adjusting your search or filters.'
      )}
      skeletonKeyPrefix='users-skeleton'
      applyHeaderSize
      toolbarProps={{
        searchPlaceholder: t('Filter by username, name or email...'),
        filters: [
          {
            columnId: 'status',
            title: t('Status'),
            options: getUserStatusOptions(t),
            singleSelect: true,
          },
          {
            columnId: 'role',
            title: t('Role'),
            options: getUserRoleOptions(t),
            singleSelect: true,
          },
        ],
      }}
      getRowClassName={(row, { isMobile }) => {
        if (!isDisabledUserRow(row.original)) return undefined
        if (isMobile) return DISABLED_ROW_MOBILE
        return DISABLED_ROW_DESKTOP
      }}
      bulkActions={<DataTableBulkActions table={table} />}
    />
  )
}
