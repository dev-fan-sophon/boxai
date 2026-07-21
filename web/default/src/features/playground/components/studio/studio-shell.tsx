/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Link } from '@tanstack/react-router'
import {
  ChevronLeft,
  ChevronRight,
  History,
  Library,
  PanelLeftClose,
  PanelRightClose,
  WalletCards,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDefaultLayout, usePanelRef } from 'react-resizable-panels'

import { Button } from '@/components/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { PricingModel } from '@/features/pricing/types'
import { useMediaQuery } from '@/hooks/use-media-query'

import type { StudioModality } from '../../types'
import { ModelBrandIcon } from './model-brand-icon'

type StudioShellProps = {
  model?: PricingModel
  modelName: string
  modality: StudioModality
  group: string
  balance: string
  catalog: React.ReactNode
  history: React.ReactNode
  children: React.ReactNode
}

export function StudioShell(props: StudioShellProps) {
  const { t } = useTranslation()
  const desktopCatalog = useMediaQuery('(min-width: 1024px)')
  const desktopHistory = useMediaQuery('(min-width: 1280px)')
  const [catalogSheetOpen, setCatalogSheetOpen] = useState(false)
  const [historySheetOpen, setHistorySheetOpen] = useState(false)
  const [catalogCollapsed, setCatalogCollapsed] = useState(false)
  const [historyCollapsed, setHistoryCollapsed] = useState(false)
  const catalogPanelRef = usePanelRef()
  const historyPanelRef = usePanelRef()
  const panelIds = ['catalog', 'workspace']
  if (desktopHistory) panelIds.push('history')
  const layout = useDefaultLayout({
    id: 'playground-studio-layout-v1',
    panelIds,
  })

  useEffect(() => {
    if (desktopCatalog) setCatalogSheetOpen(false)
    if (desktopHistory) setHistorySheetOpen(false)
  }, [desktopCatalog, desktopHistory])

  useEffect(() => {
    setCatalogSheetOpen(false)
  }, [props.modelName])

  const toggleCatalog = () => {
    if (!desktopCatalog) {
      setCatalogSheetOpen(true)
      return
    }
    if (catalogPanelRef.current?.isCollapsed()) {
      catalogPanelRef.current.expand()
    } else {
      catalogPanelRef.current?.collapse()
    }
  }
  const toggleHistory = () => {
    if (!desktopHistory) {
      setHistorySheetOpen(true)
      return
    }
    if (historyPanelRef.current?.isCollapsed()) {
      historyPanelRef.current.expand()
    } else {
      historyPanelRef.current?.collapse()
    }
  }

  return (
    <div className='bg-background relative flex size-full min-h-0 flex-col overflow-hidden'>
      <header className='flex h-14 shrink-0 items-center justify-between gap-3 border-b px-2 md:px-3'>
        <div className='flex min-w-0 items-center gap-1.5'>
          <Button
            variant='ghost'
            size='icon'
            onClick={toggleCatalog}
            aria-controls='studio-catalog'
            aria-expanded={
              desktopCatalog ? !catalogCollapsed : catalogSheetOpen
            }
            aria-haspopup={desktopCatalog ? undefined : 'dialog'}
            aria-label={
              desktopCatalog && !catalogCollapsed
                ? t('Hide model catalog')
                : t('Open model catalog')
            }
          >
            {desktopCatalog && !catalogCollapsed ? (
              <PanelLeftClose className='size-4' />
            ) : (
              <Library className='size-4' />
            )}
          </Button>
          <div className='bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg border'>
            <ModelBrandIcon
              modelName={props.modelName}
              icon={props.model?.icon}
              vendorIcon={props.model?.vendor_icon}
              size={20}
            />
          </div>
          <div className='min-w-0'>
            <p className='truncate font-mono text-sm font-semibold'>
              {props.modelName || t('Select a model')}
            </p>
            <p className='text-muted-foreground truncate text-xs capitalize'>
              {t(props.modality[0].toUpperCase() + props.modality.slice(1))} ·{' '}
              {props.group}
            </p>
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-1 md:gap-2'>
          <div className='hidden text-right sm:block'>
            <p className='text-muted-foreground text-[11px]'>
              {t('Available balance')}
            </p>
            <p className='text-sm font-medium tabular-nums'>{props.balance}</p>
          </div>
          <Button
            render={<Link to='/wallet' />}
            variant='outline'
            size='sm'
            aria-label={t('Wallet')}
          >
            <WalletCards className='size-4' />
            <span className='hidden sm:inline'>{t('Wallet')}</span>
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={toggleHistory}
            aria-controls='studio-history'
            aria-expanded={
              desktopHistory ? !historyCollapsed : historySheetOpen
            }
            aria-haspopup={desktopHistory ? undefined : 'dialog'}
            aria-label={
              desktopHistory && !historyCollapsed
                ? t('Hide task history')
                : t('Open task history')
            }
          >
            {desktopHistory && !historyCollapsed ? (
              <PanelRightClose className='size-4' />
            ) : (
              <History className='size-4' />
            )}
          </Button>
        </div>
      </header>

      <div className='min-h-0 flex-1'>
        <ResizablePanelGroup
          orientation='horizontal'
          defaultLayout={layout.defaultLayout}
          onLayoutChanged={layout.onLayoutChanged}
        >
          {desktopCatalog && (
            <>
              <ResizablePanel
                id='catalog'
                panelRef={catalogPanelRef}
                defaultSize={280}
                minSize={224}
                maxSize={380}
                collapsedSize={0}
                collapsible
                groupResizeBehavior='preserve-pixel-size'
                onResize={(size) => setCatalogCollapsed(size.inPixels === 0)}
              >
                <aside id='studio-catalog' className='h-full min-w-0 border-r'>
                  {!catalogCollapsed && props.catalog}
                </aside>
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}
          <ResizablePanel
            id='workspace'
            minSize={desktopCatalog ? 480 : 0}
            groupResizeBehavior='preserve-relative-size'
          >
            <main className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden'>
              {props.children}
            </main>
          </ResizablePanel>
          {desktopHistory && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                id='history'
                panelRef={historyPanelRef}
                defaultSize={300}
                minSize={260}
                maxSize={400}
                collapsedSize={0}
                collapsible
                groupResizeBehavior='preserve-pixel-size'
                onResize={(size) => setHistoryCollapsed(size.inPixels === 0)}
              >
                <aside id='studio-history' className='h-full min-w-0 border-l'>
                  {!historyCollapsed && props.history}
                </aside>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      <Sheet open={catalogSheetOpen} onOpenChange={setCatalogSheetOpen}>
        <SheetContent side='left' className='w-[88%] p-0 sm:max-w-sm'>
          <SheetHeader className='sr-only'>
            <SheetTitle>{t('Model catalog')}</SheetTitle>
            <SheetDescription>
              {t('Choose a model for your next run.')}
            </SheetDescription>
          </SheetHeader>
          <div id='studio-catalog' className='h-full'>
            {catalogSheetOpen && props.catalog}
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={historySheetOpen} onOpenChange={setHistorySheetOpen}>
        <SheetContent className='w-[88%] p-0 sm:max-w-sm'>
          <SheetHeader className='sr-only'>
            <SheetTitle>{t('Task history')}</SheetTitle>
            <SheetDescription>
              {t('Video and media tasks update automatically.')}
            </SheetDescription>
          </SheetHeader>
          <div id='studio-history' className='h-full'>
            {historySheetOpen && props.history}
          </div>
        </SheetContent>
      </Sheet>

      {desktopCatalog && catalogCollapsed && (
        <Button
          className='absolute top-1/2 left-0 z-10 h-12 w-5 -translate-y-1/2 rounded-l-none px-0 shadow-sm'
          variant='outline'
          onClick={toggleCatalog}
          aria-label={t('Open model catalog')}
        >
          <ChevronRight className='size-3.5' />
        </Button>
      )}
      {desktopHistory && historyCollapsed && (
        <Button
          className='absolute top-1/2 right-0 z-10 h-12 w-5 -translate-y-1/2 rounded-r-none px-0 shadow-sm'
          variant='outline'
          onClick={toggleHistory}
          aria-label={t('Open task history')}
        >
          <ChevronLeft className='size-3.5' />
        </Button>
      )}
    </div>
  )
}
