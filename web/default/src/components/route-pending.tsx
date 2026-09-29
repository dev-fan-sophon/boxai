import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'

/**
 * Router-wide pending placeholder. The root `NavigationProgress` bar already
 * signals the navigation, so this only holds the page's space with a quiet
 * skeleton instead of collapsing to nothing while a route chunk or loader is
 * in flight.
 */
export function RoutePending() {
  const { t } = useTranslation()
  return (
    <div
      className='mx-auto flex min-h-[60vh] w-full max-w-6xl flex-col gap-4 px-4 py-8'
      aria-busy='true'
    >
      <span className='sr-only' role='status'>
        {t('Loading...')}
      </span>
      <Skeleton className='h-7 w-48 opacity-60' />
      <Skeleton className='h-4 w-full max-w-md opacity-40' />
      <Skeleton className='mt-2 h-48 w-full opacity-30' />
    </div>
  )
}
