import { Database, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { TableRow, TableCell } from '@/components/ui/table'

interface TableEmptyProps {
  colSpan: number
  /** @default 'No Data' */
  title?: string
  /** @default 'No records found. Try adjusting your filters.' */
  description?: string
  /** @default Database */
  icon?: LucideIcon
  /** Extra content below the message, e.g. a "Create" button. */
  action?: ReactNode
}

/** The shared empty state, laid out as a full-width table row. */
export function TableEmpty(props: TableEmptyProps) {
  const { t } = useTranslation()
  return (
    <TableRow>
      <TableCell colSpan={props.colSpan} className='h-[400px] p-0'>
        <EmptyState
          icon={props.icon ?? Database}
          title={props.title ?? t('No Data')}
          description={
            props.description ??
            t('No records found. Try adjusting your filters.')
          }
          action={props.action}
          bordered={false}
          className='h-full min-h-0'
        />
      </TableCell>
    </TableRow>
  )
}
