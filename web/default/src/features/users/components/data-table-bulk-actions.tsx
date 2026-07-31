import type { Table } from '@tanstack/react-table'
import { Wand2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTableBulkActions as BulkActionsToolbar } from '@/components/data-table'
import { Button } from '@/components/ui/button'

import type { AdminUserRow } from '../types'
import { BulkActionsDialog } from './ops/bulk-actions-dialog'
import { useUsers } from './users-provider'

interface DataTableBulkActionsProps {
  table: Table<AdminUserRow>
}

export function DataTableBulkActions({ table }: DataTableBulkActionsProps) {
  const { t } = useTranslation()
  const { triggerRefresh } = useUsers()
  const [dialogOpen, setDialogOpen] = useState(false)

  const selectedIds = table
    .getFilteredSelectedRowModel()
    .rows.map((row) => row.original.id)

  return (
    <>
      <BulkActionsToolbar table={table} entityName='user'>
        <Button
          variant='outline'
          size='sm'
          onClick={() => setDialogOpen(true)}
          aria-label={t('Bulk action')}
        >
          <Wand2 />
          {t('Bulk action')}
        </Button>
      </BulkActionsToolbar>
      <BulkActionsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        userIds={selectedIds}
        onApplied={() => {
          table.resetRowSelection()
          triggerRefresh()
        }}
      />
    </>
  )
}
