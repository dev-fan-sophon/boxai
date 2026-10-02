import { flexRender, type Row } from '@tanstack/react-table'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import { cn } from '@/lib/utils'

import { CHANNEL_STATUS } from '../constants'
import { isTagAggregateRow, parseGroupsList } from '../lib'
import type { Channel } from '../types'
import { ChannelRowActionsLayoutContext } from './channel-row-actions-context'
import { useChannels } from './channels-provider'

const SENSITIVE_MASK = '••••'

/**
 * Bespoke channel card for the card view. Reuses every column's existing cell
 * renderer via `flexRender`, so the table's information and interactions are
 * preserved: row selection, provider/multi-key/IO.NET type badge, id,
 * name/remark + warning icons, status (with tooltips), groups, inline
 * priority/weight spinners, balance refresh, response/test times, tag
 * expand-collapse, and the per-row (or per-tag) actions menu.
 */
function ChannelCardComponent({
  row,
  isSelected,
}: {
  row: Row<Channel>
  isSelected: boolean
}) {
  const { t } = useTranslation()
  const { sensitiveVisible } = useChannels()
  const isTagRow = isTagAggregateRow(row.original)
  const cells = row.getAllCells()

  const renderCell = (id: string) => {
    const cell = cells.find((c) => c.column.id === id)
    if (!cell || !cell.column.columnDef.cell) {
      return null
    }
    return flexRender(cell.column.columnDef.cell, cell.getContext())
  }

  const fieldLabels: Record<string, string> = {
    balance: t('Used / Remaining'),
    response_time: t('Response'),
    test_time: t('Last Tested'),
  }

  const groups = parseGroupsList(row.original.group ?? '')

  const selectCell = renderCell('select')
  const typeCell = renderCell('type')
  const nameCell = renderCell('name')
  const statusCell = renderCell('status')
  const actionsCell = renderCell('actions')
  const priorityCell = renderCell('priority')
  const weightCell = renderCell('weight')
  const balanceCell = renderCell('balance')
  const responseCell = renderCell('response_time')
  const testCell = renderCell('test_time')

  const labelClass = 'text-muted-foreground text-2xs font-medium select-none'

  // In card view the enable/disable state is already conveyed by the inline
  // power toggle, so the plain "Enabled"/"Disabled" badge is redundant. Keep
  // only the informative states (e.g. auto-disabled, unknown) and tag rows.
  const showStatusBadge =
    isTagRow ||
    (row.original.status !== CHANNEL_STATUS.ENABLED &&
      row.original.status !== CHANNEL_STATUS.MANUAL_DISABLED)

  return (
    <ChannelRowActionsLayoutContext.Provider value='card'>
      <div
        data-state={isSelected ? 'selected' : undefined}
        className='flex h-full flex-col gap-3'
      >
        {/* Row 1: selection + type, with status badge + actions menu */}
        <div className='flex items-center justify-between gap-2'>
          <div className='flex min-w-0 flex-1 items-center gap-2'>
            {!isTagRow && selectCell && (
              <span className='shrink-0'>{selectCell}</span>
            )}
            <div className='min-w-0 overflow-hidden'>{typeCell}</div>
          </div>
          <div className='flex shrink-0 items-center gap-1.5'>
            {showStatusBadge && statusCell}
            {actionsCell}
          </div>
        </div>

        {/* Identity: id + name/remark (with its warning icons). */}
        <div className='min-w-0 text-sm'>
          {!isTagRow && (
            <div className={cn('tabular-nums', labelClass)}>
              #{sensitiveVisible ? row.original.id : SENSITIVE_MASK}
            </div>
          )}
          {nameCell}
        </div>

        {/* Routing controls and health, as label-over-value pairs on one
          hairline-separated grid so every card lines up. */}
        <dl className='border-border/60 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3'>
          <div className='flex min-w-0 flex-col gap-1'>
            <dt className={labelClass}>{t('Priority')}</dt>
            <dd>{priorityCell}</dd>
          </div>
          <div className='flex min-w-0 flex-col gap-1'>
            <dt className={labelClass}>{t('Weight')}</dt>
            <dd>{weightCell}</dd>
          </div>
          <div className='flex min-w-0 flex-col gap-1'>
            <dt className={labelClass}>{fieldLabels.response_time}</dt>
            <dd className='min-w-0 ps-1.5 text-sm'>
              {responseCell ?? <span className='text-muted-foreground'>-</span>}
            </dd>
          </div>
          <div className='flex min-w-0 flex-col gap-1'>
            <dt className={labelClass}>{fieldLabels.test_time}</dt>
            <dd className='min-w-0 ps-1.5 text-sm'>
              {testCell ?? <span className='text-muted-foreground'>-</span>}
            </dd>
          </div>
          <div className='col-span-2 flex min-w-0 flex-col gap-1'>
            <dt className={labelClass}>{fieldLabels.balance}</dt>
            <dd className='min-w-0 ps-1.5 text-sm'>
              {balanceCell ?? <span className='text-muted-foreground'>-</span>}
            </dd>
          </div>
        </dl>

        {/* Last row: groups span the full width, showing every group (no label) */}
        <div className='mt-auto min-w-0'>
          {groups.length > 0 ? (
            <div className='-ml-1.5 flex flex-wrap gap-1'>
              {groups.map((g) => (
                <GroupBadge
                  key={g}
                  group={g}
                  label={sensitiveVisible ? undefined : SENSITIVE_MASK}
                  size='sm'
                />
              ))}
            </div>
          ) : (
            <span className='text-muted-foreground text-sm'>-</span>
          )}
        </div>
      </div>
    </ChannelRowActionsLayoutContext.Provider>
  )
}

/**
 * Memoized so each card only re-renders when its own react-table row reference
 * changes, instead of every card re-rendering whenever the parent table state
 * (filters, pagination, sensitive toggle, etc.) updates.
 */
export const ChannelCard = memo(ChannelCardComponent)
