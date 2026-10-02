import { useTranslation } from 'react-i18next'

import { Loader2, type IconProps } from '@/components/icons'
import { cn } from '@/lib/utils'

function Spinner({ className, ...props }: IconProps) {
  const { t } = useTranslation()
  return (
    <Loader2
      weight='bold'
      role='status'
      aria-label={t('Loading')}
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  )
}

export { Spinner }
