import { useTranslation } from 'react-i18next'

import { CheckCircle2 } from '@/components/icons'
import { StatusBadge } from '@/components/status-badge'
import { Separator } from '@/components/ui/separator'

import type { SetupFormValues, SetupStatus } from '../types'

interface CompleteStepProps {
  status?: SetupStatus
  values: SetupFormValues
}

const USAGE_MODE_LABEL_KEYS: Record<SetupFormValues['usageMode'], string> = {
  external: 'External operations mode',
  self: 'Personal use mode',
  demo: 'Demo site mode',
}

const DATABASE_VARIANT: Record<
  string,
  'info' | 'success' | 'warning' | 'neutral'
> = {
  sqlite: 'warning',
  mysql: 'success',
  postgres: 'success',
}

export function CompleteStep({ status, values }: CompleteStepProps) {
  const { t } = useTranslation()
  const usageLabelKey = USAGE_MODE_LABEL_KEYS[values.usageMode]
  const dbType = status?.database_type ?? 'Unknown'
  const databaseVariant = DATABASE_VARIANT[dbType.toLowerCase()] ?? 'neutral'

  return (
    <div className='flex flex-col items-center gap-6 text-center'>
      <div className='bg-success-subtle text-success rounded-2xl p-4'>
        <CheckCircle2 className='size-8' />
      </div>
      <div className='space-y-2'>
        <h2 className='text-2xl font-semibold tracking-tight'>
          {t('Ready to initialize')}
        </h2>
        <p className='text-muted-foreground max-w-lg text-sm text-pretty sm:text-base'>
          {t(
            'Double check the configuration below. Your system will be locked until initialization is complete.'
          )}
        </p>
      </div>

      <div className='bg-surface-subtle ring-border/60 w-full rounded-xl p-5 text-left ring-1'>
        <dl className='grid gap-4 sm:grid-cols-3'>
          <div className='space-y-1.5'>
            <dt className='text-muted-foreground text-xs font-medium'>
              {t('Database')}
            </dt>
            <dd className='flex flex-wrap items-center gap-2'>
              <span className='text-sm font-semibold'>{dbType}</span>
              <StatusBadge
                label={dbType}
                variant={databaseVariant}
                copyable={false}
              />
            </dd>
          </div>

          <Separator />

          <div className='space-y-1.5'>
            <dt className='text-muted-foreground text-xs font-medium'>
              {t('Administrator account')}
            </dt>
            <dd className='text-sm font-semibold'>
              {status?.root_init
                ? t('Existing account will be reused')
                : values.username || t('Not set yet')}
            </dd>
          </div>

          <Separator />

          <div className='space-y-1.5'>
            <dt className='text-muted-foreground text-xs font-medium'>
              {t('Usage mode')}
            </dt>
            <dd className='text-sm font-semibold'>{t(usageLabelKey)}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
