/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
'use client'

import { BarChart3, ClipboardCopy, Download, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import {
  buildTableChartSpec,
  tableToCsv,
  tableToMarkdown,
  type ChartSpec,
  type TableData,
} from './chart-spec'
import { ChartSpecRenderer } from './response-chart'

function copyText(text: string, successMessage: string) {
  if (!navigator?.clipboard?.writeText) return
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success(successMessage))
}

function downloadCsv(data: TableData) {
  const blob = new Blob([`\ufeff${tableToCsv(data)}`], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'table.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

function TableToolButton(props: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={props.label}
            className='size-7'
            onClick={props.onClick}
            size='icon-sm'
            type='button'
            variant='ghost'
          >
            {props.children}
          </Button>
        }
      />
      <TooltipContent>
        <p>{props.label}</p>
      </TooltipContent>
    </Tooltip>
  )
}

const CHART_TYPES: Array<ChartSpec['type']> = ['bar', 'line', 'pie']

const CHART_TYPE_LABEL_KEYS: Record<ChartSpec['type'], string> = {
  bar: 'Bar',
  line: 'Line',
  area: 'Area',
  pie: 'Pie',
}

/**
 * Hover toolbar for markdown tables: copy as Markdown/CSV, download CSV,
 * and one-click visualization of numeric columns.
 */
export function TableTools(props: { data: TableData }) {
  const { t } = useTranslation()
  const [visualizeOpen, setVisualizeOpen] = useState(false)
  const [chartType, setChartType] = useState<ChartSpec['type']>('bar')
  const canVisualize = useMemo(
    () => buildTableChartSpec(props.data, 'bar') !== null,
    [props.data]
  )
  const spec = useMemo(
    () => (visualizeOpen ? buildTableChartSpec(props.data, chartType) : null),
    [chartType, props.data, visualizeOpen]
  )

  return (
    <>
      <div className='bg-background/90 border-border/70 absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded-lg border p-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-focus-within/table:opacity-100 group-hover/table:opacity-100'>
        {canVisualize && (
          <TableToolButton
            label={t('Visualize table')}
            onClick={() => setVisualizeOpen(true)}
          >
            <BarChart3 className='size-3.5' />
          </TableToolButton>
        )}
        <TableToolButton
          label={t('Copy as Markdown')}
          onClick={() => copyText(tableToMarkdown(props.data), t('Copied!'))}
        >
          <FileText className='size-3.5' />
        </TableToolButton>
        <TableToolButton
          label={t('Copy as CSV')}
          onClick={() => copyText(tableToCsv(props.data), t('Copied!'))}
        >
          <ClipboardCopy className='size-3.5' />
        </TableToolButton>
        <TableToolButton
          label={t('Download CSV')}
          onClick={() => downloadCsv(props.data)}
        >
          <Download className='size-3.5' />
        </TableToolButton>
      </div>

      <Dialog
        open={visualizeOpen}
        onOpenChange={setVisualizeOpen}
        title={t('Table visualization')}
        contentClassName='sm:max-w-3xl'
      >
        <div className='space-y-3'>
          <div
            className='bg-muted/60 inline-flex items-center gap-0.5 rounded-md p-0.5'
            role='tablist'
            aria-label={t('Chart type')}
          >
            {CHART_TYPES.map((type) => (
              <button
                key={type}
                type='button'
                role='tab'
                aria-selected={chartType === type}
                onClick={() => setChartType(type)}
                className={cn(
                  'focus-visible:ring-ring rounded px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2',
                  chartType === type
                    ? 'bg-background text-primary shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t(CHART_TYPE_LABEL_KEYS[type])}
              </button>
            ))}
          </div>
          {spec ? (
            <ChartSpecRenderer spec={spec} />
          ) : (
            <p className='text-muted-foreground text-sm'>
              {t('No numeric columns to visualize.')}
            </p>
          )}
        </div>
      </Dialog>
    </>
  )
}
