import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

/** Hairline "or" separator between sign-in method groups. */
export function AuthDivider(props: { className?: string }) {
  const { t } = useTranslation()
  return (
    <div
      className={cn('flex items-center gap-3', props.className)}
      role='separator'
    >
      <span className='bg-border h-px flex-1' />
      <span className='text-muted-foreground text-xs'>{t('or')}</span>
      <span className='bg-border h-px flex-1' />
    </div>
  )
}
