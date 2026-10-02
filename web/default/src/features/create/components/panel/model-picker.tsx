import { Check, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { ModelBrandIcon } from '@/features/playground/components/catalog/model-brand-icon'
import { getModelModality } from '@/features/playground/lib/studio/model-modality'
import { compareVendorNames } from '@/features/pricing/lib/model-helpers'
import type { PricingModel } from '@/features/pricing/types'
import { cn } from '@/lib/utils'
import { usePlaygroundStore } from '@/stores/playground-store'

import type { CreateTool } from '../../constants'

type ModelPickerProps = {
  modality: CreateTool
  catalogModels: PricingModel[]
  loading: boolean
  value: string
  onChange: (modelName: string) => void
  className?: string
}

/**
 * Engine picker scoped to one tool: only models of this modality that the
 * user can actually call, grouped by provider in Model Hub order.
 */
export function ModelPicker(props: ModelPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const available = usePlaygroundStore((state) => state.models)

  const groups = useMemo(() => {
    const availableNames = new Set(available.map((item) => item.value))
    const byVendor = new Map<string, PricingModel[]>()
    for (const model of props.catalogModels) {
      if (!availableNames.has(model.model_name)) continue
      if (getModelModality(model) !== props.modality) continue
      const vendor = model.vendor_name?.trim() ?? ''
      byVendor.set(vendor, [...(byVendor.get(vendor) ?? []), model])
    }
    return [...byVendor.entries()]
      .map(([vendor, models]) => ({
        vendor,
        models: models.sort((a, b) => a.model_name.localeCompare(b.model_name)),
      }))
      .sort((a, b) => compareVendorNames(a.vendor, b.vendor))
  }, [available, props.catalogModels, props.modality])

  const selected = props.catalogModels.find(
    (model) => model.model_name === props.value
  )
  const modelCount = groups.reduce((sum, group) => sum + group.models.length, 0)

  if (props.loading && modelCount === 0) {
    return (
      <Skeleton className={cn('h-12 w-full rounded-xl', props.className)} />
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type='button'
            className={cn(
              'group border-border/70 bg-background hover:border-border hover:bg-muted/40 focus-visible:ring-ring flex h-12 w-full items-center gap-2.5 rounded-xl border px-2.5 text-left outline-none transition-ui focus-visible:ring-2',
              props.className
            )}
            aria-label={t('Select a model')}
          />
        }
      >
        <span className='bg-muted/60 ring-border/60 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1'>
          <ModelBrandIcon
            modelName={props.value}
            icon={selected?.icon}
            vendorIcon={selected?.vendor_icon}
            size={18}
          />
        </span>
        <span className='min-w-0 flex-1'>
          <span className='text-foreground block truncate text-sm font-semibold'>
            {props.value || t('Select a model')}
          </span>
          <span className='text-muted-foreground text-2xs block truncate'>
            {selected?.vendor_name ||
              t('{{count}} models available', { count: modelCount })}
          </span>
        </span>
        <ChevronsUpDown
          className='text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors'
          aria-hidden='true'
        />
      </PopoverTrigger>
      <PopoverContent align='start' className='w-(--anchor-width) min-w-72 p-0'>
        <Command>
          <CommandInput placeholder={t('Search models')} />
          <CommandList className='max-h-80'>
            <CommandEmpty>{t('No models match these filters.')}</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup
                key={group.vendor || '__other'}
                heading={group.vendor || t('Other providers')}
              >
                {group.models.map((model) => (
                  <CommandItem
                    key={model.model_name}
                    value={`${model.model_name} ${group.vendor}`}
                    onSelect={() => {
                      props.onChange(model.model_name)
                      setOpen(false)
                    }}
                    className='gap-2.5'
                  >
                    <ModelBrandIcon
                      modelName={model.model_name}
                      icon={model.icon}
                      vendorIcon={model.vendor_icon}
                      size={16}
                    />
                    <span className='min-w-0 flex-1 truncate font-mono text-xs'>
                      {model.model_name}
                    </span>
                    {model.model_name === props.value && (
                      <Check
                        className='text-primary size-4'
                        aria-hidden='true'
                      />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
