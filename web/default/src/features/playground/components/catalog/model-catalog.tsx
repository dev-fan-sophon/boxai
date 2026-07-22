/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import {
  AudioLines,
  Image,
  Layers,
  MessageSquare,
  Pin,
  Search,
  Video,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import type { PricingModel } from '../../../pricing/types'
import { getModelModality } from '../../lib/studio/model-modality'
import {
  isLikelyNewModel,
  modalityLabelKey,
  MODALITY_COLORS,
} from '../../lib/workbench/modality-styles'
import type { ModelOption, StudioModality } from '../../types'
import { ModelBrandIcon } from './model-brand-icon'

const modalities: Array<'all' | StudioModality | 'mine'> = [
  'all',
  'chat',
  'image',
  'video',
  'audio',
  'mine',
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
  pinnedModels?: string[]
  onTogglePin?: (modelName: string) => void
  duoEnabled?: boolean
  onOpenDuo?: () => void
}

export function ModelCatalog(props: ModelCatalogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [modality, setModality] = useState<'all' | StudioModality | 'mine'>(
    'all'
  )
  const [vendor, setVendor] = useState('all')
  const pinnedSet = useMemo(
    () => new Set(props.pinnedModels ?? []),
    [props.pinnedModels]
  )
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
    const list = catalog.filter((model) => {
      const searchable =
        `${model.model_name} ${model.description ?? ''} ${model.vendor_name ?? ''}`.toLowerCase()
      const modelModality = getModelModality(model)
      if (!searchable.includes(normalizedQuery)) return false
      if (vendor !== 'all' && model.vendor_name !== vendor) return false
      if (modality === 'mine') return pinnedSet.has(model.model_name)
      if (modality !== 'all' && modelModality !== modality) return false
      return true
    })
    // Pinned models float to top within current filter
    return list.sort((a, b) => {
      const ap = pinnedSet.has(a.model_name) ? 0 : 1
      const bp = pinnedSet.has(b.model_name) ? 0 : 1
      if (ap !== bp) return ap - bp
      return a.model_name.localeCompare(b.model_name)
    })
  }, [catalog, modality, pinnedSet, query, vendor])

  return (
    <div className='flex h-full min-h-0 flex-col bg-transparent'>
      <div className='space-y-2.5 border-b border-border p-3'>
        <div className='relative'>
          <Search
            aria-hidden='true'
            className='absolute top-2 left-2.5 size-3.5 text-muted-foreground'
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Search models')}
            aria-label={t('Search models')}
            className='h-8 border-border bg-muted/40 pl-8 text-foreground placeholder:text-muted-foreground focus-visible:border-primary/40 focus-visible:ring-ring/30'
          />
        </div>
        <div
          className='flex flex-wrap gap-1'
          role='group'
          aria-label={t('Filter by modality')}
        >
          {modalities.map((item) => {
            let label = item[0].toUpperCase() + item.slice(1)
            if (item === 'all') label = 'All'
            if (item === 'mine') label = 'Mine'
            return (
              <button
                key={item}
                type='button'
                className={cn(
                  'h-7 rounded-lg px-2 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  modality === item
                    ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
                onClick={() => setModality(item)}
                aria-pressed={modality === item}
              >
                {t(label)}
              </button>
            )
          })}
        </div>
        <NativeSelect
          className='w-full border-border bg-muted/40 text-foreground'
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

      <div className='min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2'>
        {props.onOpenDuo && (
          <button
            type='button'
            onClick={props.onOpenDuo}
            className={cn(
              'mb-1 flex w-full items-start gap-2.5 rounded-[11px] border border-dashed border-primary/25 bg-primary/[0.06] p-2.5 text-left outline-none transition-colors',
              'hover:border-primary/40 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring',
              props.duoEnabled &&
                'border-solid border-primary/40 shadow-sm'
            )}
          >
            <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary'>
              <Layers className='size-4' aria-hidden='true' />
            </span>
            <span className='min-w-0'>
              <span className='block text-xs font-semibold text-primary'>
                {t('Multi-model collaboration')}
              </span>
              <span className='mt-0.5 line-clamp-2 text-[11px] text-muted-foreground'>
                {t('Compare answers from several chat models, then summarize.')}
              </span>
            </span>
          </button>
        )}

        {props.loading &&
          ['one', 'two', 'three', 'four', 'five', 'six'].map((key) => (
            <Skeleton
              key={key}
              className='h-[4.5rem] w-full rounded-[11px] bg-muted/50'
            />
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
        <div className='space-y-1.5'>
          {filtered.map((model) => {
            const modelModality = getModelModality(model)
            const ModalityIcon = modalityIcons[modelModality]
            const selected = props.selected === model.model_name
            const pinned = pinnedSet.has(model.model_name)
            const isNew = isLikelyNewModel(model)
            return (
              <div
                key={model.model_name}
                className={cn(
                  'group relative w-full rounded-[11px] border border-transparent transition-all',
                  selected
                    ? 'border-primary/30 bg-primary/10 shadow-sm'
                    : 'hover:border-border hover:bg-muted/40'
                )}
              >
                <button
                  type='button'
                  onClick={() => props.onSelect(model)}
                  aria-current={selected ? 'true' : undefined}
                  className='w-full p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
                >
                  <div className='flex items-start justify-between gap-2'>
                    <span className='flex min-w-0 items-center gap-2'>
                      <span className='flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60'>
                        <ModelBrandIcon
                          modelName={model.model_name}
                          icon={model.icon}
                          vendorIcon={model.vendor_icon}
                          size={22}
                        />
                      </span>
                      <span className='min-w-0'>
                        <span className='flex items-center gap-1.5'>
                          <span className='block truncate font-mono text-xs font-semibold text-foreground'>
                            {model.model_name}
                          </span>
                          {isNew && (
                            <span className='shrink-0 rounded bg-rose-500/20 px-1 py-px text-[9px] font-bold tracking-wide text-rose-300 ring-1 ring-rose-400/30'>
                              {t('NEW')}
                            </span>
                          )}
                        </span>
                        <span className='mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground'>
                          <ModalityIcon
                            className='size-3'
                            aria-hidden='true'
                          />
                          {model.vendor_name ||
                            t(modalityLabelKey(modelModality))}
                        </span>
                      </span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize',
                        MODALITY_COLORS[modelModality].tag
                      )}
                    >
                      {t(modalityLabelKey(modelModality))}
                    </span>
                  </div>
                  <p className='mt-1.5 line-clamp-2 text-[11px] text-pretty text-muted-foreground'>
                    {model.description ||
                      model.vendor_description ||
                      t('Available for generation')}
                  </p>
                </button>
                {props.onTogglePin && (
                  <button
                    type='button'
                    className={cn(
                      'absolute top-2 right-2 rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      pinned
                        ? 'text-primary'
                        : 'text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground/80'
                    )}
                    aria-label={
                      pinned ? t('Unpin model') : t('Pin model')
                    }
                    aria-pressed={pinned}
                    onClick={(event) => {
                      event.stopPropagation()
                      props.onTogglePin?.(model.model_name)
                    }}
                  >
                    <Pin
                      className={cn('size-3.5', pinned && 'fill-current')}
                      aria-hidden='true'
                    />
                  </button>
                )}
              </div>
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
      <p className='text-sm text-pretty text-muted-foreground'>{props.text}</p>
      <Button
        size='sm'
        variant='outline'
        className='border-border bg-muted/50 text-foreground hover:bg-muted'
        onClick={props.onAction}
      >
        {props.action}
      </Button>
    </div>
  )
}
