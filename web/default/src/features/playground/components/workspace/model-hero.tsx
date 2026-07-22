/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useTranslation } from 'react-i18next'

import type { PricingModel } from '@/features/pricing/types'
import { cn } from '@/lib/utils'

import { ModelBrandIcon } from '../catalog/model-brand-icon'

type ModelHeroProps = {
  model?: PricingModel
  modelName: string
  className?: string
  compact?: boolean
}

export function ModelHero(props: ModelHeroProps) {
  const { t } = useTranslation()
  const description =
    props.model?.description ||
    props.model?.vendor_description ||
    props.model?.usage_notes ||
    t('Select a model from the catalog to start creating.')

  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-2xl flex-col items-center px-4 text-center',
        props.compact ? 'gap-3 py-4' : 'gap-5 py-8 md:py-12',
        props.className
      )}
    >
      <div
        className={cn(
          'relative flex items-center justify-center rounded-full bg-muted/40 ring-1 ring-border',
          props.compact ? 'size-16' : 'size-24 md:size-28',
          'shadow-sm'
        )}
      >
        <ModelBrandIcon
          modelName={props.modelName || 'model'}
          icon={props.model?.icon}
          vendorIcon={props.model?.vendor_icon}
          size={props.compact ? 36 : 56}
        />
      </div>
      {!props.compact && (
        <p className='text-foreground font-mono text-sm font-semibold'>
          {props.modelName || t('Select a model')}
        </p>
      )}
      <div className='border-border bg-muted/60 max-h-40 overflow-y-auto rounded-2xl border px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'>
        <p className='text-muted-foreground text-sm leading-relaxed text-pretty'>
          {description}
        </p>
      </div>
    </div>
  )
}
