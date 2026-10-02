import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { History, LayoutGrid } from '@/components/icons'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useLgUp } from '@/hooks'
import { cn } from '@/lib/utils'

import { SessionHistoryPanel } from './session-history-panel'

type RailTab = 'models' | 'sessions'

function RailTabs(props: {
  value: RailTab
  onChange: (tab: RailTab) => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'border-sidebar-border flex h-12 shrink-0 items-center border-b px-2.5 sm:h-14 sm:px-3',
        props.className
      )}
    >
      <SegmentedControl<RailTab>
        fullWidth
        size='md'
        aria-label={t('Left panel')}
        value={props.value}
        onValueChange={props.onChange}
        options={[
          {
            value: 'models',
            label: t('Models'),
            icon: <LayoutGrid aria-hidden='true' />,
          },
          {
            value: 'sessions',
            label: t('Chats'),
            icon: <History aria-hidden='true' />,
          },
        ]}
        className='w-full'
      />
    </div>
  )
}

type PlaygroundShellProps = {
  catalog: React.ReactNode
  /** Right settings column (desktop only) */
  settings?: React.ReactNode
  catalogOpen: boolean
  onCatalogOpenChange: (open: boolean) => void
  children: React.ReactNode
  className?: string
}

/**
 * Playground layout: toolbar, left rail with Models | Chats tabs (desktop),
 * workspace center, optional settings column. The model catalog stays the
 * default rail face (aggregator identity); the Chats tab hosts thread history.
 */
export function PlaygroundShell(props: PlaygroundShellProps) {
  const { t } = useTranslation()
  const isDesktop = useLgUp()
  const { catalogOpen, onCatalogOpenChange } = props
  const [railTab, setRailTab] = useState<RailTab>('models')

  // On desktop the catalog sheet does not exist; open requests focus the
  // rail's Models tab instead (composer model chip, breakpoint crossing).
  useEffect(() => {
    if (isDesktop && catalogOpen) {
      setRailTab('models')
      onCatalogOpenChange(false)
    }
  }, [isDesktop, catalogOpen, onCatalogOpenChange])

  const handleCatalogOpen = (open: boolean) => {
    onCatalogOpenChange(open)
  }

  return (
    <div
      className={cn(
        'playground-workbench bg-background text-foreground relative flex size-full min-h-0 flex-col overflow-hidden',
        'pb-[env(safe-area-inset-bottom,0px)]',
        props.className
      )}
      data-playground-workbench=''
    >
      <div className='relative flex min-h-0 flex-1'>
        {isDesktop && (
          <aside className='playground-rail bg-sidebar text-sidebar-foreground border-sidebar-border flex w-[min(288px,28vw)] shrink-0 flex-col border-r'>
            <RailTabs value={railTab} onChange={setRailTab} />
            <div
              className={cn('min-h-0 flex-1', railTab !== 'models' && 'hidden')}
            >
              {props.catalog}
            </div>
            {railTab === 'sessions' && (
              <div className='min-h-0 flex-1'>
                <SessionHistoryPanel embedded />
              </div>
            )}
          </aside>
        )}

        <main className='playground-stage relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
          {props.children}
        </main>

        {isDesktop && props.settings}
      </div>

      <Sheet open={!isDesktop && catalogOpen} onOpenChange={handleCatalogOpen}>
        <SheetContent
          side='left'
          className='bg-sidebar text-sidebar-foreground border-sidebar-border w-[min(92vw,22rem)] p-0 sm:max-w-sm'
        >
          <SheetHeader className='sr-only'>
            <SheetTitle>{t('Model catalog')}</SheetTitle>
            <SheetDescription>
              {t('Choose a model for your next run.')}
            </SheetDescription>
          </SheetHeader>
          <div className='flex h-full flex-col pt-[env(safe-area-inset-top,0px)]'>
            {catalogOpen && (
              <>
                {/* Leave room for the sheet's close button. */}
                <RailTabs
                  value={railTab}
                  onChange={setRailTab}
                  className='pr-12 sm:pr-12'
                />
                <div
                  className={cn(
                    'min-h-0 flex-1',
                    railTab !== 'models' && 'hidden'
                  )}
                >
                  {props.catalog}
                </div>
                {railTab === 'sessions' && (
                  <div className='min-h-0 flex-1'>
                    <SessionHistoryPanel
                      embedded
                      onSelectSession={() => onCatalogOpenChange(false)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
