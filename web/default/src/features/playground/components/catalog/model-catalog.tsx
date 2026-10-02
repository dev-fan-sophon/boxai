import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AudioLines,
  Image,
  Layers,
  LayoutGrid,
  MessageSquare,
  Pin,
  Search,
  Video,
  X,
  type IconComponent,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { compareVendorNames } from '@/features/pricing/lib/model-helpers'
import { cn } from '@/lib/utils'

import type { PricingModel } from '../../../pricing/types'
import { isPlaygroundImageModel } from '../../lib/studio/image-request-schema'
import { getModelModality } from '../../lib/studio/model-modality'
import {
  isLikelyNewModel,
  modalityLabelKey,
  MODALITY_COLORS,
} from '../../lib/workbench/modality-styles'
import type { ModelOption, StudioModality } from '../../types'
import { getBrandColor } from './brand-color'
import { ModelBrandIcon } from './model-brand-icon'

type CatalogFilter = 'all' | StudioModality

const FILTERS: Array<{
  id: CatalogFilter
  labelKey: string
  Icon: IconComponent
}> = [
  { id: 'all', labelKey: 'All', Icon: LayoutGrid },
  { id: 'chat', labelKey: 'Chat', Icon: MessageSquare },
  { id: 'image', labelKey: 'Image', Icon: Image },
  { id: 'video', labelKey: 'Video', Icon: Video },
  { id: 'audio', labelKey: 'Audio', Icon: AudioLines },
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
  /** Restrict the catalog to these modalities; one modality hides the filter row. */
  modalities?: StudioModality[]
}

export function ModelCatalog(props: ModelCatalogProps) {
  const { t } = useTranslation()
  const [modality, setModality] = useState<CatalogFilter>('all')
  const [query, setQuery] = useState('')
  const pinnedSet = useMemo(
    () => new Set(props.pinnedModels ?? []),
    [props.pinnedModels]
  )
  const availableNames = useMemo(
    () => new Set(props.available.map((item) => item.value)),
    [props.available]
  )
  const allowed = props.modalities
  const catalog = useMemo(
    () =>
      props.models.filter(
        (model) =>
          availableNames.has(model.model_name) &&
          (!allowed || allowed.includes(getModelModality(model)))
      ),
    [allowed, availableNames, props.models]
  )
  const filters = FILTERS.filter(
    (item) => item.id === 'all' || !allowed || allowed.includes(item.id)
  )
  const showFilters = filters.length > 2

  const counts = useMemo(() => {
    const next: Record<CatalogFilter, number> = {
      all: 0,
      chat: 0,
      image: 0,
      video: 0,
      audio: 0,
    }
    for (const model of catalog) {
      const modelModality = getModelModality(model)
      if (
        modelModality === 'image' &&
        !isPlaygroundImageModel(model.model_name)
      ) {
        continue
      }
      next.all += 1
      next[modelModality] += 1
    }
    return next
  }, [catalog])

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return catalog.filter((model) => {
      const modelModality = getModelModality(model)
      if (
        modelModality === 'image' &&
        !isPlaygroundImageModel(model.model_name)
      ) {
        return false
      }
      if (modality !== 'all' && modelModality !== modality) return false
      if (!normalizedQuery) return true
      return (
        model.model_name.toLowerCase().includes(normalizedQuery) ||
        (model.vendor_name ?? '').toLowerCase().includes(normalizedQuery) ||
        (model.description ?? '').toLowerCase().includes(normalizedQuery)
      )
    })
  }, [catalog, modality, query])

  // Pinned models float to a dedicated section; the rest group by provider
  // using the same marketplace vendor order as Model Hub.
  const groups = useMemo(() => {
    const byName = (a: PricingModel, b: PricingModel) =>
      a.model_name.localeCompare(b.model_name)
    const pinned: PricingModel[] = []
    const byVendor = new Map<string, PricingModel[]>()
    for (const model of filtered) {
      if (pinnedSet.has(model.model_name)) {
        pinned.push(model)
        continue
      }
      const vendor = model.vendor_name?.trim() ?? ''
      const list = byVendor.get(vendor)
      if (list) {
        list.push(model)
      } else {
        byVendor.set(vendor, [model])
      }
    }
    const vendorGroups = [...byVendor.entries()]
      .map(([vendor, models]) => ({ vendor, models: models.sort(byName) }))
      .sort((a, b) => compareVendorNames(a.vendor, b.vendor))
    return { pinned: pinned.sort(byName), vendorGroups }
  }, [filtered, pinnedSet])

  return (
    <div className='flex h-full min-h-0 flex-col bg-transparent'>
      <div className='border-border/70 shrink-0 border-b px-2.5 py-2.5 sm:px-3'>
        {showFilters && (
          <div
            className='bg-muted/45 ring-border/60 grid grid-cols-5 gap-0.5 rounded-xl p-0.5 ring-1'
            role='tablist'
            aria-label={t('Filter by modality')}
          >
            {filters.map((item) => {
              const Icon = item.Icon
              const active = modality === item.id
              const count = counts[item.id]
              const disabled = item.id !== 'all' && count === 0
              return (
                <button
                  key={item.id}
                  type='button'
                  role='tab'
                  aria-selected={active}
                  aria-disabled={disabled || undefined}
                  disabled={disabled}
                  onClick={() => setModality(item.id)}
                  className={cn(
                    'focus-visible:ring-ring flex min-h-9 flex-col items-center justify-center gap-0.5 rounded-[0.65rem] px-0.5 py-1.5 text-center outline-none transition-[color,background-color,box-shadow,transform] focus-visible:ring-2 active:scale-[0.98] sm:min-h-10',
                    active
                      ? 'bg-background text-primary shadow-xs ring-border/70 ring-1'
                      : 'text-muted-foreground hover:text-foreground',
                    disabled && 'pointer-events-none opacity-35'
                  )}
                >
                  <Icon
                    className={cn(
                      'size-3.5 shrink-0',
                      active ? 'text-primary' : 'opacity-80'
                    )}
                    aria-hidden='true'
                  />
                  <span className='text-3xs leading-none font-semibold tracking-wide'>
                    {t(item.labelKey)}
                  </span>
                  <span
                    className={cn(
                      'font-mono text-4xs leading-none tabular-nums',
                      active ? 'text-primary/80' : 'text-muted-foreground'
                    )}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <div className={cn('relative', showFilters && 'mt-2')}>
          <Search
            className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2'
            aria-hidden='true'
          />
          <input
            type='search'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Search models')}
            aria-label={t('Search models')}
            className='border-input bg-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/15 text-ui h-8 w-full rounded-lg border pr-7 pl-8 shadow-xs outline-none focus-visible:ring-3 [&::-webkit-search-cancel-button]:hidden'
          />
          {query && (
            <button
              type='button'
              aria-label={t('Clear search')}
              onClick={() => setQuery('')}
              className='text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1'
            >
              <X className='size-3' aria-hidden='true' />
            </button>
          )}
        </div>
      </div>

      <div className='min-h-0 flex-1 space-y-2 overflow-y-auto p-2'>
        {props.onOpenDuo && (
          <button
            type='button'
            onClick={props.onOpenDuo}
            className={cn(
              'bg-card ring-border/70 flex w-full items-center gap-2.5 rounded-xl p-2.5 text-left shadow-xs ring-1 outline-none transition-ui',
              'hover:ring-primary/30 focus-visible:ring-ring focus-visible:ring-2',
              props.duoEnabled && 'ring-primary/45 bg-primary/5'
            )}
          >
            <span className='bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg'>
              <Layers className='size-4' aria-hidden='true' />
            </span>
            <span className='min-w-0'>
              <span className='text-foreground block text-xs font-semibold'>
                {t('Multi-model collaboration')}
              </span>
              <span className='text-muted-foreground text-2xs mt-0.5 line-clamp-2'>
                {t('Compare answers from several chat models, then summarize.')}
              </span>
            </span>
          </button>
        )}

        {props.loading &&
          ['one', 'two', 'three', 'four', 'five', 'six'].map((key) => (
            <Skeleton
              key={key}
              className='bg-muted/50 h-11 w-full rounded-xl'
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
            action={t('Show all')}
            onAction={() => {
              setModality('all')
              setQuery('')
            }}
          />
        )}

        {groups.pinned.length > 0 && (
          <section>
            <GroupHeader
              label={t('Pinned')}
              count={groups.pinned.length}
              icon={
                <Pin
                  weight='fill'
                  className='text-primary size-3'
                  aria-hidden='true'
                />
              }
            />
            <div className='space-y-0.5 pt-1'>
              {groups.pinned.map((model) => (
                <ModelCard
                  key={model.model_name}
                  model={model}
                  selected={props.selected === model.model_name}
                  pinned
                  showModality={showFilters}
                  onSelect={props.onSelect}
                  onTogglePin={props.onTogglePin}
                />
              ))}
            </div>
          </section>
        )}

        {groups.vendorGroups.map((group) => (
          <section key={group.vendor || '__other'}>
            <GroupHeader
              label={group.vendor || t('Other providers')}
              count={group.models.length}
              icon={
                group.vendor ? (
                  <ModelBrandIcon
                    modelName={group.models[0].model_name}
                    icon={group.models[0].vendor_icon || group.models[0].icon}
                    size={14}
                  />
                ) : (
                  <LayoutGrid
                    className='text-muted-foreground size-3'
                    aria-hidden='true'
                  />
                )
              }
            />
            <div className='space-y-0.5 pt-1'>
              {group.models.map((model) => (
                <ModelCard
                  key={model.model_name}
                  model={model}
                  selected={props.selected === model.model_name}
                  pinned={pinnedSet.has(model.model_name)}
                  showModality={showFilters}
                  onSelect={props.onSelect}
                  onTogglePin={props.onTogglePin}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function GroupHeader(props: {
  label: string
  count: number
  icon?: React.ReactNode
}) {
  return (
    <div className='bg-sidebar/90 sticky -top-2 z-10 -mx-2 flex min-w-0 items-center gap-1.5 px-4 pt-2 pb-1 backdrop-blur-md'>
      {props.icon}
      <span className='text-muted-foreground text-2xs min-w-0 truncate font-medium'>
        {props.label}
      </span>
      <span className='text-muted-foreground/70 text-2xs tabular-nums'>
        {props.count}
      </span>
    </div>
  )
}

function ModelCard(props: {
  model: PricingModel
  selected: boolean
  pinned: boolean
  /** Mixed-modality catalogs label each row; single-modality ones do not. */
  showModality: boolean
  onSelect: (model: PricingModel) => void
  onTogglePin?: (modelName: string) => void
}) {
  const { t } = useTranslation()
  const { model, selected, pinned } = props
  const modelModality = getModelModality(model)
  const ModalityIcon = modalityIcons[modelModality]
  const isNew = isLikelyNewModel(model)
  const brand = getBrandColor(model.icon, model.vendor_icon)

  return (
    <div
      className={cn(
        'group relative w-full rounded-xl transition-ui',
        selected
          ? 'bg-card shadow-xs ring-primary/35 ring-1'
          : 'hover:bg-accent/70'
      )}
      style={
        {
          '--brand': brand ?? 'var(--muted-foreground)',
        } as React.CSSProperties
      }
    >
      <button
        type='button'
        onClick={() => props.onSelect(model)}
        aria-current={selected ? 'true' : undefined}
        title={model.model_name}
        className={cn(
          'focus-visible:ring-ring relative flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset',
          props.onTogglePin && 'pr-9'
        )}
      >
        <span
          className='bg-card ring-border/80 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1'
          style={{
            backgroundImage:
              'linear-gradient(color-mix(in srgb, var(--brand) 10%, transparent), color-mix(in srgb, var(--brand) 10%, transparent))',
          }}
        >
          <ModelBrandIcon
            modelName={model.model_name}
            icon={model.icon}
            vendorIcon={model.vendor_icon}
            size={18}
          />
        </span>
        <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <span
            className={cn(
              'truncate font-mono text-xs leading-4 font-medium',
              selected ? 'text-primary' : 'text-foreground'
            )}
          >
            {model.model_name}
          </span>
          {(props.showModality || isNew) && (
            <span className='text-muted-foreground text-2xs flex min-w-0 items-center gap-1.5 leading-4'>
              {props.showModality && (
                <>
                  <ModalityIcon
                    className={cn(
                      'size-3 shrink-0',
                      MODALITY_COLORS[modelModality].text
                    )}
                    aria-hidden='true'
                  />
                  <span className='truncate'>
                    {t(modalityLabelKey(modelModality))}
                  </span>
                </>
              )}
              {isNew && (
                <span className='bg-info-subtle text-info-subtle-foreground text-3xs shrink-0 rounded-full px-1.5 py-px font-semibold'>
                  {t('NEW')}
                </span>
              )}
            </span>
          )}
        </span>
      </button>
      {props.onTogglePin && (
        <button
          type='button'
          className={cn(
            'focus-visible:ring-ring absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1.5 outline-none transition-opacity duration-control focus-visible:opacity-100 focus-visible:ring-2',
            pinned
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-60'
          )}
          aria-label={pinned ? t('Unpin model') : t('Pin model')}
          aria-pressed={pinned}
          onClick={(event) => {
            event.stopPropagation()
            props.onTogglePin?.(model.model_name)
          }}
        >
          <Pin
            weight={pinned ? 'fill' : undefined}
            className='size-3.5'
            aria-hidden='true'
          />
        </button>
      )}
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
