/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { ChevronDown, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'

import type { PricingModel } from '../../../pricing/types'
import { getModelModality } from '../../lib/studio/model-modality'
import {
  MODALITY_COLORS,
  modalityLabelKey,
} from '../../lib/workbench/modality-styles'
import { ModelBrandIcon } from '../catalog/model-brand-icon'

type WorkspaceHeaderProps = {
  model: string
  pricingModel?: PricingModel
  group: string
  mode: 'model' | 'duo'
  /** Opens the catalog drawer on mobile */
  onOpenCatalog: () => void
  /** Extra actions rendered at the right edge (settings toggle, etc.) */
  actions?: React.ReactNode
}

/**
 * Workspace header showing the current model (or duo mode). On mobile the
 * model block doubles as the catalog drawer trigger.
 */
export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  const { t } = useTranslation()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const modality = getModelModality(
    props.pricingModel ?? { model_name: props.model }
  )

  const modelInfo =
    props.mode === 'duo' ? (
      <span className='flex min-w-0 items-center gap-2'>
        <span className='bg-primary/15 text-primary flex size-7 shrink-0 items-center justify-center rounded-lg'>
          <Layers className='size-4' aria-hidden='true' />
        </span>
        <span className='text-foreground truncate text-sm font-semibold'>
          {t('Multi-model collaboration')}
        </span>
      </span>
    ) : (
      <span className='flex min-w-0 items-center gap-2'>
        <span className='border-border bg-muted/60 flex size-7 shrink-0 items-center justify-center rounded-lg border'>
          <ModelBrandIcon
            modelName={props.model}
            icon={props.pricingModel?.icon}
            vendorIcon={props.pricingModel?.vendor_icon}
            size={18}
          />
        </span>
        <span className='text-foreground truncate font-mono text-sm font-semibold'>
          {props.model}
        </span>
        <span
          className={cn(
            'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize',
            MODALITY_COLORS[modality].tag
          )}
        >
          {t(modalityLabelKey(modality))}
        </span>
        {props.group && (
          <span className='bg-muted/50 text-muted-foreground hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] sm:inline'>
            {props.group}
          </span>
        )}
      </span>
    )

  return (
    <div className='border-border flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3'>
      {isDesktop ? (
        modelInfo
      ) : (
        <button
          type='button'
          onClick={props.onOpenCatalog}
          className='focus-visible:ring-ring flex min-w-0 items-center gap-1.5 rounded-lg py-1 pr-1.5 text-left outline-none focus-visible:ring-2'
          aria-label={t('Open catalog')}
        >
          {modelInfo}
          <ChevronDown
            className='text-muted-foreground size-3.5 shrink-0'
            aria-hidden='true'
          />
        </button>
      )}
      {props.actions && (
        <div className='flex shrink-0 items-center gap-1.5'>{props.actions}</div>
      )}
    </div>
  )
}
