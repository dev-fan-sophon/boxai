import type { Row } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import { API_KEY_STATUSES } from '../constants'
import { getQuotaProgressClass } from '../lib/quota-progress'
import type { ApiKey } from '../types'
import { ApiKeyTimestampCell } from './api-key-timestamp-cell'
import { ApiKeyCell } from './api-keys-cells'
import { DataTableRowActions } from './data-table-row-actions'

/**
 * One API key as a card: name + status, the copyable key, the remaining quota
 * with a meter, and when it was last used / expires. Shared by the desktop
 * card view and the mobile list so both read the same.
 */
export function ApiKeyCard(props: { row: Row<ApiKey>; now: number }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const apiKey = props.row.original
  const statusConfig = API_KEY_STATUSES[apiKey.status]
  const total = apiKey.used_quota + apiKey.remain_quota
  const percentage = total > 0 ? (apiKey.remain_quota / total) * 100 : 0
  const isExpired =
    apiKey.expired_time !== -1 && apiKey.expired_time * 1000 < props.now

  return (
    <div className='flex min-w-0 flex-col gap-3'>
      <div className='flex min-w-0 items-start justify-between gap-2'>
        <div className='flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 pt-0.5'>
          <span
            className='min-w-0 truncate text-sm font-semibold'
            title={apiKey.name}
          >
            {apiKey.name}
          </span>
          {statusConfig && (
            <StatusBadge
              label={t(statusConfig.label)}
              variant={statusConfig.variant}
              copyable={false}
              className='shrink-0'
            />
          )}
        </div>
        <div className='-mt-1 -mr-1 shrink-0'>
          <DataTableRowActions row={props.row} />
        </div>
      </div>

      <div className='min-w-0'>
        <ApiKeyCell apiKey={apiKey} />
      </div>

      <div className='flex min-w-0 flex-col gap-1.5'>
        <div className='flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs'>
          <span className='text-muted-foreground'>{t('Quota')}</span>
          {apiKey.unlimited_quota ? (
            <span className='text-foreground font-medium'>
              {t('Follow user')}
            </span>
          ) : (
            <span className='text-foreground font-medium tabular-nums'>
              {formatQuota(apiKey.remain_quota)}
              <span className='text-muted-foreground font-normal'>
                {' / '}
                {formatQuota(total)}
              </span>
            </span>
          )}
        </div>
        {!apiKey.unlimited_quota && (
          <Progress
            value={percentage}
            aria-label={t('Quota')}
            className={cn('h-1', getQuotaProgressClass(percentage))}
          />
        )}
      </div>

      <div className='text-muted-foreground text-2xs grid grid-cols-2 gap-3 border-t pt-2.5'>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <span className='truncate'>{t('Last Used')}</span>
          <ApiKeyTimestampCell
            timestamp={apiKey.accessed_time}
            now={props.now}
            locale={locale}
            justNowLabel={t('Just now')}
            className='text-foreground'
          />
        </div>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <span className='truncate'>{t('Expires')}</span>
          {apiKey.expired_time === -1 ? (
            <span className='text-foreground text-xs'>{t('Never')}</span>
          ) : (
            <ApiKeyTimestampCell
              timestamp={apiKey.expired_time}
              now={props.now}
              locale={locale}
              justNowLabel={t('Just now')}
              className={isExpired ? 'text-destructive' : 'text-foreground'}
            />
          )}
        </div>
      </div>
    </div>
  )
}
