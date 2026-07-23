/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Bot, Lightbulb, Loader2, Sparkles, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PlaygroundView } from '@/stores/playground-store'

type PlaygroundToolbarProps = {
  view: PlaygroundView
  onViewChange: (view: PlaygroundView) => void
  isChatGenerating: boolean
  isStudioPending: boolean
  onStopChat: () => void
}

const VIEWS: Array<{
  id: PlaygroundView
  labelKey: string
  icon: typeof Sparkles
}> = [
  { id: 'workspace', labelKey: 'Workspace', icon: Sparkles },
  { id: 'agents', labelKey: 'Agents', icon: Bot },
  { id: 'inspiration', labelKey: 'Inspiration', icon: Lightbulb },
]

/**
 * Playground-level toolbar: view switcher on the left, generation status
 * indicator (replacing the old busy strip) on the right.
 */
export function PlaygroundToolbar(props: PlaygroundToolbarProps) {
  const { t } = useTranslation()
  const generating = props.isChatGenerating || props.isStudioPending

  return (
    <div className='flex min-w-0 flex-1 items-center justify-between gap-2 sm:gap-3'>
      <div
        className='bg-muted/45 ring-border/70 flex gap-0.5 rounded-xl p-0.5 ring-1 sm:gap-1 sm:p-1'
        role='tablist'
        aria-label={t('Playground views')}
      >
        {VIEWS.map((view) => {
          const Icon = view.icon
          const active = props.view === view.id
          return (
            <button
              key={view.id}
              type='button'
              role='tab'
              aria-selected={active}
              aria-label={t(view.labelKey)}
              onClick={() => props.onViewChange(view.id)}
              className={cn(
                'focus-visible:ring-ring flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-[color,background-color,box-shadow,transform] outline-none focus-visible:ring-2 active:scale-[0.98] sm:min-h-0 sm:px-2.5 sm:py-1',
                active
                  ? 'bg-primary/15 text-primary shadow-xs ring-primary/25 ring-1'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className='size-3.5 shrink-0' aria-hidden='true' />
              <span className='hidden sm:inline'>{t(view.labelKey)}</span>
            </button>
          )
        })}
      </div>

      {generating && (
        <div className='flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2'>
          <span className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
            <Loader2
              className='text-primary size-3.5 animate-spin'
              aria-hidden='true'
            />
            <span className='hidden md:inline'>
              {props.isChatGenerating
                ? t('Generation in progress…')
                : t('Studio task still running…')}
            </span>
          </span>
          {props.isChatGenerating && (
            <Button
              size='sm'
              variant='outline'
              className='h-8 px-2.5 sm:h-7'
              onClick={props.onStopChat}
            >
              <Square className='size-3 fill-current' aria-hidden='true' />
              <span className='hidden sm:inline'>{t('Stop')}</span>
            </Button>
          )}
          {props.view !== 'workspace' && (
            <Button
              size='sm'
              className='bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-2.5 sm:h-7'
              onClick={() => props.onViewChange('workspace')}
            >
              <span className='sm:hidden'>{t('Workspace')}</span>
              <span className='hidden sm:inline'>{t('Back to workspace')}</span>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
