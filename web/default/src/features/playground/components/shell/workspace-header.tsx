import { ChevronDown, Layers, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useLgUp } from '@/hooks'

import type { PricingModel } from '../../../pricing/types'
import { ModelBrandIcon } from '../catalog/model-brand-icon'

type WorkspaceHeaderProps = {
  model: string
  pricingModel?: PricingModel
  group: string
  mode: 'model' | 'duo'
  sessionTitle?: string
  /** Opens the catalog drawer on mobile (desktop catalog lives in the left rail) */
  onOpenCatalog: () => void
  /** Start a new chat */
  onNewSession?: () => void
  /** Extra actions rendered at the right edge (settings toggle, etc.) */
  actions?: React.ReactNode
}

/**
 * Workspace header showing the current model (or duo mode). On mobile the
 * model block doubles as the catalog drawer trigger.
 */
export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  const { t } = useTranslation()
  const isDesktop = useLgUp()

  let modelInfo: React.ReactNode
  if (props.mode === 'duo') {
    modelInfo = (
      <span className='flex min-w-0 items-center gap-2'>
        <span className='bg-primary/15 text-primary flex size-7 shrink-0 items-center justify-center rounded-lg'>
          <Layers className='size-4' aria-hidden='true' />
        </span>
        <span className='text-foreground truncate text-sm font-semibold'>
          {t('Multi-model collaboration')}
        </span>
      </span>
    )
  } else {
    modelInfo = (
      <span className='flex min-w-0 items-center gap-2'>
        <span className='border-border bg-muted/60 flex size-7 shrink-0 items-center justify-center rounded-lg border'>
          <ModelBrandIcon
            modelName={props.model}
            icon={props.pricingModel?.icon}
            vendorIcon={props.pricingModel?.vendor_icon}
            size={18}
          />
        </span>
        <span className='min-w-0'>
          <span className='text-foreground block truncate text-sm font-semibold'>
            {props.sessionTitle || t('New chat')}
          </span>
          <span className='text-muted-foreground text-2xs block truncate font-mono'>
            {props.model || t('Select a model')}
          </span>
        </span>
      </span>
    )
  }

  return (
    <div className='playground-workspace-header border-border/70 flex h-11 shrink-0 items-center justify-between gap-2 border-b px-2 sm:h-12 sm:px-3'>
      {isDesktop ? (
        <div className='flex min-w-0 items-center gap-1.5 py-1 pr-1.5 pl-0.5'>
          {modelInfo}
        </div>
      ) : (
        <button
          type='button'
          onClick={props.onOpenCatalog}
          className='focus-visible:ring-ring hover:bg-muted/50 active:bg-muted flex min-h-9 min-w-0 items-center gap-1.5 rounded-xl py-1 pr-1.5 pl-0.5 text-left transition-colors outline-none focus-visible:ring-2'
          aria-label={t('Open catalog')}
        >
          {modelInfo}
          <ChevronDown
            className='text-muted-foreground size-3.5 shrink-0'
            aria-hidden='true'
          />
        </button>
      )}
      <div className='flex shrink-0 items-center gap-0.5 sm:gap-1'>
        {props.onNewSession && (
          <Button
            size='icon'
            variant='ghost'
            className='text-muted-foreground hover:text-foreground size-9 touch-manipulation sm:size-8'
            aria-label={t('New chat')}
            onClick={props.onNewSession}
          >
            <Plus className='size-4' />
          </Button>
        )}
        {props.actions}
      </div>
    </div>
  )
}
