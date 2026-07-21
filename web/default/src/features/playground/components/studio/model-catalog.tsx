/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { AudioLines, Image, MessageSquare, Search, Video } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import type { PricingModel } from '../../../pricing/types'
import { getModelModality } from '../../lib/studio/model-modality'
import type { ModelOption, StudioModality } from '../../types'
import { ModelBrandIcon } from './model-brand-icon'

const modalities: Array<'all' | StudioModality> = [
  'all',
  'chat',
  'image',
  'video',
  'audio',
]

const modalityIcons = {
  chat: MessageSquare,
  image: Image,
  video: Video,
  audio: AudioLines,
} as const

type ModelCatalogProps = {
  available: ModelOption[]
  models: PricingModel[]
  selected: string
  loading: boolean
  error: boolean
  onRetry: () => void
  onSelect: (model: PricingModel) => void
}

export function ModelCatalog(props: ModelCatalogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [modality, setModality] = useState<'all' | StudioModality>('all')
  const [vendor, setVendor] = useState('all')
  const availableNames = useMemo(
    () => new Set(props.available.map((item) => item.value)),
    [props.available]
  )
  const catalog = useMemo(
    () => props.models.filter((model) => availableNames.has(model.model_name)),
    [availableNames, props.models]
  )
  const vendors = useMemo(
    () =>
      [
        ...new Set(catalog.map((model) => model.vendor_name).filter(Boolean)),
      ] as string[],
    [catalog]
  )
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return catalog.filter((model) => {
      const searchable =
        `${model.model_name} ${model.description ?? ''} ${model.vendor_name ?? ''}`.toLowerCase()
      return (
        searchable.includes(normalizedQuery) &&
        (modality === 'all' || getModelModality(model) === modality) &&
        (vendor === 'all' || model.vendor_name === vendor)
      )
    })
  }, [catalog, modality, query, vendor])

  return (
    <div className='bg-muted/20 flex h-full min-h-0 flex-col'>
      <div className='space-y-3 border-b p-3'>
        <div>
          <h2 className='text-sm font-semibold text-balance'>
            {t('Model catalog')}
          </h2>
          <p className='text-muted-foreground text-xs text-pretty'>
            {t('Choose a model for your next run.')}
          </p>
        </div>
        <div className='relative'>
          <Search
            aria-hidden='true'
            className='text-muted-foreground absolute top-2 left-2.5 size-4'
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Search models')}
            aria-label={t('Search models')}
            className='h-8 pl-8'
          />
        </div>
        <div
          className='flex flex-wrap gap-1'
          role='group'
          aria-label={t('Filter by modality')}
        >
          {modalities.map((item) => (
            <Button
              key={item}
              size='sm'
              variant={modality === item ? 'secondary' : 'ghost'}
              className='h-7 px-2 text-xs'
              onClick={() => setModality(item)}
              aria-pressed={modality === item}
            >
              {t(
                item === 'all' ? 'All' : item[0].toUpperCase() + item.slice(1)
              )}
            </Button>
          ))}
        </div>
        <NativeSelect
          className='w-full'
          size='sm'
          value={vendor}
          onChange={(event) => setVendor(event.target.value)}
          aria-label={t('Filter by vendor')}
        >
          <NativeSelectOption value='all'>
            {t('All vendors')}
          </NativeSelectOption>
          {vendors.map((name) => (
            <NativeSelectOption key={name} value={name}>
              {name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className='min-h-0 flex-1 space-y-1 overflow-y-auto p-2'>
        {props.loading &&
          ['one', 'two', 'three', 'four', 'five', 'six'].map((key) => (
            <Skeleton key={key} className='h-20 w-full' />
          ))}
        {props.error && (
          <CatalogState
            text={t('Model catalog could not be loaded.')}
            action={t('Try again')}
            onAction={props.onRetry}
          />
        )}
        {!props.loading && !props.error && filtered.length === 0 && (
          <CatalogState
            text={t('No models match these filters.')}
            action={t('Clear filters')}
            onAction={() => {
              setQuery('')
              setModality('all')
              setVendor('all')
            }}
          />
        )}
        <div className='space-y-1'>
          {filtered.map((model) => {
            const modelModality = getModelModality(model)
            const ModalityIcon = modalityIcons[modelModality]
            const selected = props.selected === model.model_name
            return (
              <button
                type='button'
                key={model.model_name}
                onClick={() => props.onSelect(model)}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'hover:bg-muted/70 focus-visible:ring-ring w-full rounded-lg border border-transparent p-2.5 text-left outline-none transition-colors focus-visible:ring-2',
                  selected && 'border-primary/30 bg-primary/5 shadow-xs'
                )}
              >
                <div className='flex items-start justify-between gap-2'>
                  <span className='flex min-w-0 items-center gap-2'>
                    <span className='bg-background flex size-9 shrink-0 items-center justify-center rounded-lg border shadow-xs'>
                      <ModelBrandIcon
                        modelName={model.model_name}
                        icon={model.icon}
                        vendorIcon={model.vendor_icon}
                        size={22}
                      />
                    </span>
                    <span className='min-w-0'>
                      <span className='block truncate font-mono text-xs font-semibold'>
                        {model.model_name}
                      </span>
                      <span className='text-muted-foreground mt-0.5 flex items-center gap-1 truncate text-[11px]'>
                        <ModalityIcon className='size-3' aria-hidden='true' />
                        {model.vendor_name ||
                          t(
                            modelModality[0].toUpperCase() +
                              modelModality.slice(1)
                          )}
                      </span>
                    </span>
                  </span>
                  <Badge variant='outline' className='shrink-0 capitalize'>
                    {t(modelModality[0].toUpperCase() + modelModality.slice(1))}
                  </Badge>
                </div>
                <p className='text-muted-foreground mt-1 line-clamp-2 text-xs text-pretty'>
                  {model.description ||
                    model.vendor_description ||
                    t('Available for generation')}
                </p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function CatalogState(props: {
  text: string
  action: string
  onAction: () => void
}) {
  return (
    <div className='grid place-items-center gap-2 px-4 py-12 text-center'>
      <p className='text-muted-foreground text-sm text-pretty'>{props.text}</p>
      <Button size='sm' variant='outline' onClick={props.onAction}>
        {props.action}
      </Button>
    </div>
  )
}
