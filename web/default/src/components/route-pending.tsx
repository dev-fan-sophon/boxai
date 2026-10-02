import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'

/**
 * Router-wide pending placeholder. The root `NavigationProgress` bar already
 * signals the navigation, so this only holds the page's space with a quiet
 * skeleton shaped like a typical page — heading, a row of summary tiles and a
 * content block — instead of collapsing to nothing while a route chunk or
 * loader is in flight. It fades in rather than cutting in, because the router
 * only shows it once a navigation has already been pending for a while.
 */
export function RoutePending() {
  const { t } = useTranslation()
  return (
    <div
      className='fade-enter mx-auto flex min-h-[60vh] w-full max-w-6xl flex-col gap-4 px-4 py-8'
      aria-busy='true'
    >
      <span className='sr-only' role='status'>
        {t('Loading...')}
      </span>
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-7 w-48' />
        <Skeleton className='h-4 w-full max-w-md opacity-70' />
      </div>
      <div className='mt-2 grid gap-3 sm:grid-cols-3'>
        <Skeleton className='h-20 rounded-xl opacity-60' />
        <Skeleton className='h-20 rounded-xl opacity-60' />
        <Skeleton className='hidden h-20 rounded-xl opacity-60 sm:block' />
      </div>
      <Skeleton className='h-48 w-full rounded-xl opacity-40' />
    </div>
  )
}
