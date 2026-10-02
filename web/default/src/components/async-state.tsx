import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { getServerErrorMessage } from '@/lib/toast'

/**
 * The slice of a TanStack `useQuery` result that `AsyncState` reads. Any
 * `UseQueryResult` satisfies it, and so does a hand-rolled object for data
 * that does not come from React Query.
 */
export interface AsyncStateQuery<TData> {
  data: TData | undefined
  isPending: boolean
  isError: boolean
  error: unknown
  refetch?: () => unknown
}

export interface AsyncStateProps<TData> {
  query: AsyncStateQuery<TData>
  /** Rendered while there is no data yet. Defaults to a centred spinner. */
  skeleton?: ReactNode
  /** Decides whether loaded data counts as empty. Defaults to `[]` / `null`. */
  isEmpty?: (data: TData) => boolean
  /** Rendered for empty data. Defaults to a generic `EmptyState`. */
  empty?: ReactNode
  /**
   * Rendered when the first load fails. Defaults to `ErrorState` with the
   * server's message and a Retry wired to `query.refetch`. A failed
   * *background* refetch keeps showing the data it already has.
   */
  error?: ReactNode | ((error: unknown, retry: () => void) => ReactNode)
  /** Title for the default error state. */
  errorTitle?: string
  children: (data: TData) => ReactNode
}

function isEmptyByDefault(data: unknown): boolean {
  if (data === null || data === undefined) return true
  return Array.isArray(data) && data.length === 0
}

/**
 * Loading → error → empty → content for one query, so every data-backed
 * surface handles the same four states with the same components (skeleton,
 * `ErrorState`, `EmptyState`) instead of a hand-rolled `if` ladder.
 *
 * ```tsx
 * <AsyncState
 *   query={sessionsQuery}
 *   skeleton={<SessionsSkeleton />}
 *   empty={<EmptyState title={t('No sessions')} />}
 * >
 *   {(sessions) => <SessionList sessions={sessions} />}
 * </AsyncState>
 * ```
 */
export function AsyncState<TData>(props: AsyncStateProps<TData>) {
  const { t } = useTranslation()
  const query = props.query

  if (query.data === undefined && query.isError) {
    const retry = () => {
      query.refetch?.()
    }
    if (typeof props.error === 'function') {
      return props.error(query.error, retry)
    }
    if (props.error !== undefined) return props.error
    return (
      <ErrorState
        className='min-h-[200px]'
        title={props.errorTitle}
        description={getServerErrorMessage(query.error)}
        onRetry={query.refetch ? retry : undefined}
      />
    )
  }

  if (query.data === undefined) {
    if (!query.isPending) return null
    return props.skeleton ?? <LoadingState />
  }

  const isEmpty = props.isEmpty ?? isEmptyByDefault
  if (isEmpty(query.data)) {
    return props.empty ?? <EmptyState title={t('No data')} />
  }

  return props.children(query.data)
}
