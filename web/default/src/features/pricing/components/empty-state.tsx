import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState as SharedEmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'

export interface EmptyStateProps {
  searchQuery?: string
  hasActiveFilters: boolean
  onClearFilters: () => void
}

export function EmptyState(props: EmptyStateProps) {
  const { t } = useTranslation()
  const hasSearch = Boolean(props.searchQuery?.trim())

  return (
    <SharedEmptyState
      className='min-h-[320px]'
      icon={Search}
      title={t('No models found')}
      description={
        hasSearch
          ? t(
              'No results for "{{query}}". Try adjusting your search or filters.',
              { query: props.searchQuery }
            )
          : t('No models match your current filters.')
      }
      action={
        (props.hasActiveFilters || hasSearch) && (
          <Button variant='outline' size='sm' onClick={props.onClearFilters}>
            {t('Clear all filters')}
          </Button>
        )
      }
    />
  )
}
