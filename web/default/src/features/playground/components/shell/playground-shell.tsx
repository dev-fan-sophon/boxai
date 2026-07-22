/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'

type PlaygroundShellProps = {
  toolbar: React.ReactNode
  catalog: React.ReactNode
  /** Right settings column (desktop only); rendered by later phases */
  settings?: React.ReactNode
  catalogOpen: boolean
  onCatalogOpenChange: (open: boolean) => void
  children: React.ReactNode
  className?: string
}

/**
 * Three-column playground layout: toolbar on top, model catalog on the
 * left (drawer on mobile), workspace center, optional settings column on
 * the right. The composer lives inside `children` in normal document flow.
 */
export function PlaygroundShell(props: PlaygroundShellProps) {
  const { t } = useTranslation()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const { catalogOpen, onCatalogOpenChange } = props

  useEffect(() => {
    if (isDesktop && catalogOpen) onCatalogOpenChange(false)
  }, [isDesktop, catalogOpen, onCatalogOpenChange])

  return (
    <div
      className={cn(
        'playground-workbench bg-background text-foreground relative flex size-full min-h-0 flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]',
        props.className
      )}
      data-playground-workbench=''
    >
      <div className='border-border flex h-12 shrink-0 items-center gap-2 border-b px-3'>
        {props.toolbar}
      </div>

      <div className='relative flex min-h-0 flex-1'>
        {isDesktop && (
          <aside className='bg-sidebar text-sidebar-foreground border-sidebar-border flex w-[300px] shrink-0 flex-col border-r'>
            {props.catalog}
          </aside>
        )}

        <main className='relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
          {props.children}
        </main>

        {isDesktop && props.settings}
      </div>

      <Sheet
        open={!isDesktop && catalogOpen}
        onOpenChange={onCatalogOpenChange}
      >
        <SheetContent
          side='left'
          className='bg-sidebar text-sidebar-foreground border-sidebar-border w-[88%] p-0 sm:max-w-sm'
        >
          <SheetHeader className='sr-only'>
            <SheetTitle>{t('Model catalog')}</SheetTitle>
            <SheetDescription>
              {t('Choose a model for your next run.')}
            </SheetDescription>
          </SheetHeader>
          <div className='flex h-full flex-col'>
            {catalogOpen && props.catalog}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
