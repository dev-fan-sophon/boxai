import { useTranslation } from 'react-i18next'

import { tone } from '@/lib/tone'
import { cn } from '@/lib/utils'

import { SettingsPageTitleStatusPortal } from './settings-page-context'

type FormDirtyIndicatorProps = {
  isDirty: boolean
  message?: string
}

/**
 * Compact page-title status indicator for unsaved form changes.
 *
 * @example
 * ```tsx
 * <FormDirtyIndicator isDirty={form.formState.isDirty} />
 * ```
 */
export function FormDirtyIndicator({
  isDirty,
  message,
}: FormDirtyIndicatorProps) {
  const { t } = useTranslation()
  if (!isDirty) return null

  return (
    <SettingsPageTitleStatusPortal>
      <span
        className={cn(
          'inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium whitespace-nowrap ring-1 ring-warning/25 ring-inset',
          tone('warning')
        )}
      >
        <span className='size-1.5 rounded-full bg-amber-500 dark:bg-amber-300' />
        {message ? t(message) : t('Unsaved changes')}
      </span>
    </SettingsPageTitleStatusPortal>
  )
}
