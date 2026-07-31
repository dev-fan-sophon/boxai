import { Download, Plus, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { exportAdminUsers } from '../api'
import { ERROR_MESSAGES } from '../constants'
import { hasActiveFilter } from '../lib/ops'
import { AudienceFilterSheet } from './ops/audience-filter-sheet'
import { SegmentDialog } from './ops/segment-dialog'
import { useUsers } from './users-provider'

export function UsersPrimaryButtons() {
  const { t } = useTranslation()
  const { setOpen, setCurrentRow, advancedFilter, setAdvancedFilter } =
    useUsers()
  const [filterOpen, setFilterOpen] = useState(false)
  const [segmentOpen, setSegmentOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const activeFilterCount = Object.keys(advancedFilter).length

  const handleExport = async () => {
    setExporting(true)
    try {
      const blob = await exportAdminUsers({ filter: advancedFilter })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `boxai-users-${Date.now()}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t(ERROR_MESSAGES.UNEXPECTED))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className='flex flex-wrap gap-2'>
      <Button variant='outline' size='sm' onClick={() => setFilterOpen(true)}>
        <SlidersHorizontal className='h-4 w-4' />
        {t('Filters')}
        {activeFilterCount > 0 && (
          <Badge variant='secondary'>{activeFilterCount}</Badge>
        )}
      </Button>
      <Button
        variant='outline'
        size='sm'
        disabled={!hasActiveFilter(advancedFilter)}
        onClick={() => setSegmentOpen(true)}
      >
        {t('Save as segment')}
      </Button>
      <Button
        variant='outline'
        size='sm'
        disabled={exporting}
        onClick={handleExport}
      >
        <Download className='h-4 w-4' />
        {t('Export')}
      </Button>
      <Button
        size='sm'
        onClick={() => {
          setCurrentRow(null)
          setOpen('create')
        }}
      >
        <Plus className='h-4 w-4' />
        {t('Add User')}
      </Button>

      <AudienceFilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        filter={advancedFilter}
        onApply={setAdvancedFilter}
      />
      <SegmentDialog
        open={segmentOpen}
        onOpenChange={setSegmentOpen}
        initialFilter={advancedFilter}
        onSaved={() => undefined}
      />
    </div>
  )
}
