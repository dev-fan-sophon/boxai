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
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

export type FenceView = 'preview' | 'code'

type FenceViewToggleProps = {
  view: FenceView
  onViewChange: (view: FenceView) => void
  /** i18n key for the preview segment, defaults to 'Preview'. */
  previewLabelKey?: string
}

/**
 * Compact Preview | Code segmented toggle shared by rich code fences
 * (mermaid, chart, html preview).
 */
export function FenceViewToggle(props: FenceViewToggleProps) {
  const { t } = useTranslation()
  const segments: Array<{ id: FenceView; label: string }> = [
    { id: 'preview', label: t(props.previewLabelKey ?? 'Preview') },
    { id: 'code', label: t('Code') },
  ]

  return (
    <div
      className='bg-muted/60 flex shrink-0 items-center gap-0.5 rounded-md p-0.5'
      role='tablist'
      aria-label={t('View mode')}
    >
      {segments.map((segment) => (
        <button
          key={segment.id}
          type='button'
          role='tab'
          aria-selected={props.view === segment.id}
          onClick={() => props.onViewChange(segment.id)}
          className={cn(
            'focus-visible:ring-ring rounded px-2 py-0.5 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2',
            props.view === segment.id
              ? 'bg-background text-primary shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {segment.label}
        </button>
      ))}
    </div>
  )
}
