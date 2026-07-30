/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import {
  ImageIcon,
  MessageSquare,
  Music2,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { MODALITY_COLORS } from '../../lib/workbench/modality-styles'
import type { StudioModality } from '../../types'

const ITEMS: Array<{
  id: StudioModality
  labelKey: string
  Icon: LucideIcon
}> = [
  { id: 'chat', labelKey: 'Chat', Icon: MessageSquare },
  { id: 'image', labelKey: 'Image', Icon: ImageIcon },
  { id: 'video', labelKey: 'Video', Icon: Video },
  { id: 'audio', labelKey: 'Audio', Icon: Music2 },
]

type ModalityQuickSwitchProps = {
  active: StudioModality
  available: StudioModality[]
  onSelect: (modality: StudioModality) => void
  className?: string
}

/**
 * Compact modality switcher for phones/tablets. Desktop keeps the catalog
 * rail as the primary way to pick models; this strip only appears below lg.
 */
export function ModalityQuickSwitch(props: ModalityQuickSwitchProps) {
  const { t } = useTranslation()
  const available = new Set(props.available)

  return (
    <div
      className={cn(
        'playground-modality-switch border-border/60 bg-background/80 no-scrollbar flex gap-1 overflow-x-auto border-b px-2 py-1.5 backdrop-blur-md lg:hidden',
        props.className
      )}
      role='tablist'
      aria-label={t('Modality')}
    >
      {ITEMS.map((item) => {
        const Icon = item.Icon
        const enabled = available.has(item.id)
        const active = props.active === item.id
        const colors = MODALITY_COLORS[item.id]
        return (
          <button
            key={item.id}
            type='button'
            role='tab'
            aria-selected={active}
            aria-disabled={!enabled}
            disabled={!enabled}
            onClick={() => enabled && props.onSelect(item.id)}
            className={cn(
              'inline-flex min-h-9 shrink-0 touch-manipulation items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-[color,background-color,border-color,transform] outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]',
              active
                ? cn(colors.tag, 'shadow-xs')
                : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              !enabled && 'cursor-not-allowed opacity-40'
            )}
          >
            <Icon className='size-3.5 shrink-0' aria-hidden='true' />
            {t(item.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
