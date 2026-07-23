/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import {
  ChevronDown,
  ImageIcon,
  Layers,
  Music2,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'

import type { PricingModel } from '../../../pricing/types'
import { getModelModality } from '../../lib/studio/model-modality'
import {
  MODALITY_COLORS,
  modalityLabelKey,
} from '../../lib/workbench/modality-styles'
import type { StudioModality } from '../../types'
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

const MEDIA_TOOL: Record<
  Exclude<StudioModality, 'chat'>,
  { titleKey: string; Icon: LucideIcon }
> = {
  image: { titleKey: 'Image generation', Icon: ImageIcon },
  video: { titleKey: 'Video generation', Icon: Video },
  audio: { titleKey: 'Audio generation', Icon: Music2 },
}

/**
 * Workspace header showing the current model (or duo mode). On mobile the
 * model block doubles as the catalog drawer trigger.
 * Image/video/audio tools show a generic modality title instead of the model id.
 */
export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  const { t } = useTranslation()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const modality = getModelModality(
    props.pricingModel ?? { model_name: props.model }
  )
  const mediaTool =
    modality === 'image' || modality === 'video' || modality === 'audio'
      ? MEDIA_TOOL[modality]
      : null

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
  } else if (mediaTool) {
    const Icon = mediaTool.Icon
    modelInfo = (
      <span className='flex min-w-0 items-center gap-2'>
        <span className='border-border bg-muted/60 flex size-7 shrink-0 items-center justify-center rounded-lg border'>
          <Icon className='size-4' aria-hidden='true' />
        </span>
        <span className='text-foreground truncate text-sm font-semibold'>
          {t(mediaTool.titleKey)}
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
        <span className='text-foreground truncate font-mono text-sm font-semibold'>
          {props.model || t('Select a model')}
        </span>
        <span
          className={cn(
            'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize',
            MODALITY_COLORS[modality].tag
          )}
        >
          {t(modalityLabelKey(modality))}
        </span>
      </span>
    )
  }

  return (
    <div className='playground-workspace-header border-border/70 flex h-11 shrink-0 items-center justify-between gap-2 border-b px-2 sm:h-12 sm:px-3'>
      {isDesktop ? (
        modelInfo
      ) : (
        <button
          type='button'
          onClick={props.onOpenCatalog}
          className='focus-visible:ring-ring hover:bg-muted/50 active:bg-muted flex min-h-9 min-w-0 items-center gap-1.5 rounded-xl py-1 pr-1.5 pl-0.5 text-left outline-none transition-colors focus-visible:ring-2'
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
        <div className='flex shrink-0 items-center gap-1 sm:gap-1.5'>
          {props.actions}
        </div>
      )}
    </div>
  )
}
