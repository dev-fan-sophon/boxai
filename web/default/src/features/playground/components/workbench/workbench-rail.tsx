/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Bot, Lightbulb, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type { WorkbenchTab } from '../../lib/workbench/workbench-prefs'

type WorkbenchRailProps = {
  tab: WorkbenchTab
  onTabChange: (tab: WorkbenchTab) => void
  catalog: React.ReactNode
  agents: React.ReactNode
  inspiration: React.ReactNode
}

const TABS: Array<{
  id: WorkbenchTab
  labelKey: string
  icon: typeof Sparkles
}> = [
  { id: 'models', labelKey: 'Models', icon: Sparkles },
  { id: 'agents', labelKey: 'Agents', icon: Bot },
  { id: 'inspiration', labelKey: 'Inspiration', icon: Lightbulb },
]

export function WorkbenchRail(props: WorkbenchRailProps) {
  const { t } = useTranslation()

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='border-sidebar-border shrink-0 border-b p-3'>
        <div
          className='bg-muted/50 ring-border grid grid-cols-3 gap-1 rounded-xl p-1 ring-1'
          role='tablist'
          aria-label={t('Workbench sections')}
        >
          {TABS.map((tab) => {
            const Icon = tab.icon
            const active = props.tab === tab.id
            return (
              <button
                key={tab.id}
                type='button'
                role='tab'
                aria-selected={active}
                onClick={() => props.onTabChange(tab.id)}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-primary/15 text-primary shadow-xs ring-1 ring-primary/25'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className='size-3.5' aria-hidden='true' />
                <span className='truncate'>{t(tab.labelKey)}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-hidden'>
        {props.tab === 'models' && props.catalog}
        {props.tab === 'agents' && props.agents}
        {props.tab === 'inspiration' && props.inspiration}
      </div>
    </div>
  )
}
