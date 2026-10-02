import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  sideDrawerContentClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import {
  ArrowUpDown,
  Check,
  Filter,
  Grid2X2,
  Table2,
  X,
} from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

import {
  VIEW_MODES,
  getSortLabels,
  type SortOption,
  type ViewMode,
} from '../constants'
import type {
  IntegrationProfile,
  PricingModel,
  PricingVendor,
  TokenUnit,
} from '../types'
import { PricingSidebar } from './pricing-sidebar'
import { SearchBar } from './search-bar'
import { VendorPills } from './vendor-pills'

export interface PricingToolbarProps {
  filteredCount: number
  totalCount?: number
  searchValue: string
  onSearchChange: (value: string) => void
  onSearchClear: () => void
  sortBy: string
  onSortChange: (value: string) => void
  tokenUnit: TokenUnit
  onTokenUnitChange: (value: TokenUnit) => void
  viewMode: ViewMode
  onViewModeChange: (value: ViewMode) => void
  quotaTypeFilter: string
  endpointTypeFilter: string
  vendorFilter: string
  groupFilter: string
  tagFilter: string
  onQuotaTypeChange: (value: string) => void
  onEndpointTypeChange: (value: string) => void
  onVendorChange: (value: string) => void
  onGroupChange: (value: string) => void
  onTagChange: (value: string) => void
  vendors: PricingVendor[]
  groups: string[]
  groupRatios?: Record<string, number>
  tags: string[]
  models: PricingModel[]
  integrationProfiles: IntegrationProfile[]
  hasActiveFilters: boolean
  activeFilterCount: number
  onClearFilters: () => void
}

export function PricingToolbar(props: PricingToolbarProps) {
  const { t } = useTranslation()
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const sortLabels = getSortLabels(t)
  const activeFilters = [
    props.vendorFilter !== 'all' && {
      label: `${t('Vendor')}: ${props.vendorFilter}`,
      clear: () => props.onVendorChange('all'),
    },
    props.groupFilter !== 'all' && {
      label: `${t('Group')}: ${props.groupFilter}`,
      clear: () => props.onGroupChange('all'),
    },
    props.tagFilter !== 'all' && {
      label: `${t('Tag')}: ${props.tagFilter}`,
      clear: () => props.onTagChange('all'),
    },
    props.quotaTypeFilter !== 'all' && {
      label: `${t('Billing type')}: ${props.quotaTypeFilter}`,
      clear: () => props.onQuotaTypeChange('all'),
    },
    props.endpointTypeFilter !== 'all' && {
      label: `${t('Protocol')}: ${props.endpointTypeFilter}`,
      clear: () => props.onEndpointTypeChange('all'),
    },
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>

  const handleViewModeChange = useCallback(
    (value: string) => props.onViewModeChange(value as ViewMode),
    [props]
  )

  const vendorsWithModels = props.vendors.filter((vendor) =>
    props.models.some((model) => model.vendor_name === vendor.name)
  )
  const showResultRow =
    activeFilters.length > 0 || props.searchValue.trim().length > 0

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
        <SearchBar
          value={props.searchValue}
          onChange={props.onSearchChange}
          onClear={props.onSearchClear}
          placeholder={t('Search service name, tags, source...')}
          size='sm'
          className='min-w-0 flex-1'
        />

        <div className='flex shrink-0 items-center gap-2'>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  aria-label={t('Sort')}
                  title={sortLabels[props.sortBy as SortOption] || t('Sort')}
                  className='w-8 px-0'
                />
              }
            >
              <ArrowUpDown className='size-3.5' />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-44'>
              {Object.entries(sortLabels).map(([value, label]) => (
                <DropdownMenuItem
                  key={value}
                  onClick={() => props.onSortChange(value)}
                  className='gap-2'
                >
                  <Check
                    className={cn(
                      'size-4 shrink-0',
                      props.sortBy === value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => setMobileFiltersOpen(true)}
            className='gap-1.5 md:hidden'
          >
            <Filter className='size-4' />
            {t('Filter')}
            {props.activeFilterCount > 0 && (
              <Badge className='text-3xs ml-0.5 size-5 justify-center p-0'>
                {props.activeFilterCount}
              </Badge>
            )}
          </Button>

          <Popover>
            <PopoverTrigger
              render={
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='hidden gap-1.5 md:inline-flex'
                />
              }
            >
              <Filter className='size-4' />
              {t('Filter')}
              {props.activeFilterCount > 0 && (
                <Badge className='text-3xs size-5 justify-center p-0'>
                  {props.activeFilterCount}
                </Badge>
              )}
            </PopoverTrigger>
            <PopoverContent
              align='end'
              className='max-h-[70vh] w-[420px] overflow-y-auto p-0'
            >
              <PricingSidebar {...props} className='border-0 shadow-none' />
            </PopoverContent>
          </Popover>

          <SegmentedControl
            size='md'
            options={[
              {
                value: VIEW_MODES.CARD,
                label: <Grid2X2 className='size-3.5' aria-hidden='true' />,
                'aria-label': t('Card view'),
              },
              {
                value: VIEW_MODES.TABLE,
                label: <Table2 className='size-3.5' aria-hidden='true' />,
                'aria-label': t('Table view'),
              },
            ]}
            value={props.viewMode}
            onValueChange={handleViewModeChange}
            aria-label={t('View mode')}
            className='[&_[role=radio]]:px-2'
          />
        </div>
      </div>

      {vendorsWithModels.length > 0 && (
        <VendorPills
          vendors={vendorsWithModels}
          value={props.vendorFilter}
          onChange={props.onVendorChange}
        />
      )}

      {showResultRow && (
        <div
          className='flex flex-wrap items-center gap-1.5'
          aria-label={t('Active filters')}
        >
          {activeFilters.map((filter) => (
            <button
              key={filter.label}
              type='button'
              onClick={filter.clear}
              className='bg-muted text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs'
            >
              {filter.label}
              <X className='size-3' />
            </button>
          ))}
          {activeFilters.length > 0 && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={props.onClearFilters}
              className='h-7 text-xs'
            >
              {t('Clear all')}
            </Button>
          )}
          <span className='text-muted-foreground ml-auto text-xs'>
            <span className='text-foreground font-semibold tabular-nums'>
              {props.filteredCount.toLocaleString()}
            </span>
            {' / '}
            {(props.totalCount ?? props.filteredCount).toLocaleString()}{' '}
            {props.filteredCount === 1 ? t('model') : t('models')}
          </span>
        </div>
      )}

      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent
          side='right'
          className={sideDrawerContentClassName('sm:max-w-md')}
        >
          <SheetHeader className={sideDrawerHeaderClassName()}>
            <SheetTitle>{t('Filter')}</SheetTitle>
            <SheetDescription>
              {t('Filter models by provider, group, type, endpoint, and tags.')}
            </SheetDescription>
          </SheetHeader>
          <div className={sideDrawerFormClassName('gap-0')}>
            <PricingSidebar
              quotaTypeFilter={props.quotaTypeFilter}
              endpointTypeFilter={props.endpointTypeFilter}
              vendorFilter={props.vendorFilter}
              groupFilter={props.groupFilter}
              tagFilter={props.tagFilter}
              onQuotaTypeChange={props.onQuotaTypeChange}
              onEndpointTypeChange={props.onEndpointTypeChange}
              onVendorChange={props.onVendorChange}
              onGroupChange={props.onGroupChange}
              onTagChange={props.onTagChange}
              tokenUnit={props.tokenUnit}
              onTokenUnitChange={props.onTokenUnitChange}
              vendors={props.vendors}
              groups={props.groups}
              groupRatios={props.groupRatios}
              tags={props.tags}
              models={props.models}
              integrationProfiles={props.integrationProfiles}
              hasActiveFilters={props.hasActiveFilters}
              onClearFilters={props.onClearFilters}
              className='border-0 bg-transparent p-0 shadow-none'
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
