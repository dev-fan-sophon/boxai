import { useTranslation } from 'react-i18next'

import { SideDrawerSection } from '@/components/drawer-layout'
import { Badge } from '@/components/ui/badge'
import { formatNumber, formatQuota, formatTimestamp } from '@/lib/format'

import type { UserBalanceSources } from '../../types'

export function UserBalanceSourcesSection(props: { data: UserBalanceSources }) {
  const { t } = useTranslation()
  const labels: Record<string, string> = {
    paid_topup: t('Paid wallet credits'),
    reward_transfer: t('Rewards transferred to wallet'),
    redemption: t('Redemption code credits'),
    checkin: t('Check-in credits'),
    admin_credit: t('Recorded admin credits'),
    admin_debit: t('Recorded admin deductions'),
  }

  return (
    <SideDrawerSection>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3 className='text-sm font-medium'>{t('Balance sources')}</h3>
        <Badge
          variant={props.data.paid_order_count > 0 ? 'success' : 'secondary'}
        >
          {props.data.paid_order_count > 0
            ? t('Payment recorded')
            : t('No payment recorded')}
        </Badge>
      </div>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Recorded lifetime credits, not the remaining balance. Refunds are excluded. Gifts and redemption codes do not prove payment.'
        )}
      </p>
      <div className='flex flex-wrap justify-between gap-2 text-xs'>
        <span>
          {t('Paid orders')}: {formatNumber(props.data.paid_order_count)}
        </span>
        <span className='text-muted-foreground'>
          {t('Last payment')}:{' '}
          {props.data.last_paid_at
            ? formatTimestamp(props.data.last_paid_at)
            : '—'}
        </span>
      </div>
      <dl className='divide-border divide-y'>
        {props.data.sources.map((source) => (
          <div
            key={source.source}
            className='flex items-start justify-between gap-4 py-2'
          >
            <dt className='min-w-0 text-xs'>
              {labels[source.source] ?? source.source}
            </dt>
            <dd className='shrink-0 text-right text-xs tabular-nums'>
              <div className='font-medium'>{formatQuota(source.quota)}</div>
              <div className='text-muted-foreground text-2xs'>
                {t('{{count}} records', { count: source.count })}
                {source.last_at > 0 && ` · ${formatTimestamp(source.last_at)}`}
              </div>
            </dd>
          </div>
        ))}
      </dl>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Historical coverage is partial: registration gifts, referral transfers and older admin changes may only have text logs or no record. Admin totals start when tracking is enabled; zero does not rule out older adjustments.'
        )}
      </p>
      {props.data.unconverted_orders > 0 && (
        <p className='text-warning text-xs' role='status'>
          {t(
            '{{count}} paid orders could not be converted to quota and are excluded from credit totals.',
            { count: props.data.unconverted_orders }
          )}
        </p>
      )}
      {props.data.adjustments.length > 0 && (
        <details className='text-xs'>
          <summary className='cursor-pointer py-1 font-medium'>
            {t('Recent admin adjustments')}
          </summary>
          <ol className='divide-border divide-y'>
            {props.data.adjustments.map((entry) => (
              <li key={entry.id} className='space-y-1 py-2'>
                <div className='flex flex-wrap justify-between gap-2'>
                  <span>
                    {t('Operator')} #{entry.operator_id}
                  </span>
                  <span className='font-medium tabular-nums'>
                    {entry.delta > 0 ? '+' : '−'}
                    {formatQuota(Math.abs(entry.delta))}
                  </span>
                </div>
                <p className='text-muted-foreground'>
                  {formatTimestamp(entry.created_at)} ·{' '}
                  {formatQuota(entry.balance_before)} →{' '}
                  {formatQuota(entry.balance_after)}
                </p>
              </li>
            ))}
          </ol>
        </details>
      )}
      {props.data.evidence_unavailable ? (
        <p className='text-warning text-xs' role='status'>
          {t(
            'Historical logs are unavailable. Source totals above are still available.'
          )}
        </p>
      ) : (
        <details className='text-xs'>
          <summary className='cursor-pointer py-1 font-medium'>
            {t('Recent funding logs (up to 20)')}
          </summary>
          <p className='text-muted-foreground py-1'>
            {t(
              'Original log amounts use the currency settings at the time and are not added to the totals again.'
            )}
          </p>
          <ol className='divide-border divide-y'>
            {props.data.historical_evidence.map((entry) => (
              <li key={entry.id} className='space-y-1 py-2'>
                <p className='wrap-anywhere'>{entry.content}</p>
                <p className='text-muted-foreground'>
                  {formatTimestamp(entry.created_at)}
                  {entry.operator_id
                    ? ` · ${t('Operator')} #${entry.operator_id}`
                    : ''}
                </p>
              </li>
            ))}
          </ol>
          {props.data.historical_evidence.length === 0 && (
            <p className='text-muted-foreground py-2'>
              {t('No retained funding logs')}
            </p>
          )}
        </details>
      )}
    </SideDrawerSection>
  )
}
