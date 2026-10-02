import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Search } from '@/components/icons'
import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-enter'
import { Button } from '@/components/ui/button'
import { BrandGlow } from '@/features/home/components/marketing'
import { useSeo } from '@/hooks/use-page-seo'

import {
  LoadingSkeleton,
  PricingTable,
  PricingToolbar,
  ModelCardGrid,
  ModelDetailsDrawer,
} from './components'
import { EXCLUDED_GROUPS, VIEW_MODES } from './constants'
import { useFilters } from './hooks/use-filters'
import { usePricingData } from './hooks/use-pricing-data'

export function Pricing() {
  const { t } = useTranslation()
  useSeo(
    useMemo(
      () => ({
        title: t('Model Pricing'),
        description: t(
          'BoxAI model pricing on you-box.com — compare token prices, capabilities, and billing modes across providers on the unified AI API gateway.'
        ),
        path: '/pricing',
      }),
      [t]
    )
  )
  const [selectedModelName, setSelectedModelName] = useState<string | null>(
    null
  )

  const {
    models,
    vendors,
    groupRatio,
    usableGroup,
    endpointMap,
    integrationProfiles,
    autoGroups,
    isLoading,
  } = usePricingData()

  const {
    searchInput,
    sortBy,
    vendorFilter,
    groupFilter,
    quotaTypeFilter,
    endpointTypeFilter,
    tagFilter,
    tokenUnit,
    viewMode,
    setSearchInput,
    setSortBy,
    setVendorFilter,
    setGroupFilter,
    setQuotaTypeFilter,
    setEndpointTypeFilter,
    setTagFilter,
    setTokenUnit,
    setViewMode,
    filteredModels,
    hasActiveFilters,
    activeFilterCount,
    availableTags,
    clearFilters,
    clearSearch,
  } = useFilters(models || [], integrationProfiles)

  const handleModelClick = useCallback((modelName: string) => {
    setSelectedModelName(modelName)
  }, [])

  const selectedModel = useMemo(
    () =>
      selectedModelName
        ? (models || []).find(
            (model) => model.model_name === selectedModelName
          ) || null
        : null,
    [models, selectedModelName]
  )

  const vendorCount = useMemo(
    () =>
      new Set(
        (models || []).map((model) => model.vendor_name?.trim()).filter(Boolean)
      ).size,
    [models]
  )

  const availableGroups = useMemo(
    () =>
      Object.keys(usableGroup || {}).filter(
        (g) => !EXCLUDED_GROUPS.includes(g)
      ),
    [usableGroup]
  )

  const handleClearAll = useCallback(() => {
    clearFilters()
    clearSearch()
  }, [clearFilters, clearSearch])

  const renderPricingContent = () => {
    if (filteredModels.length === 0) {
      const hasSearch = searchInput.trim().length > 0
      return (
        <EmptyState
          className='min-h-[320px]'
          icon={Search}
          title={t('No models found')}
          description={
            hasSearch
              ? t(
                  'No results for "{{query}}". Try adjusting your search or filters.',
                  { query: searchInput }
                )
              : t('No models match your current filters.')
          }
          action={
            (hasActiveFilters || hasSearch) && (
              <Button variant='outline' size='sm' onClick={handleClearAll}>
                {t('Clear all filters')}
              </Button>
            )
          }
        />
      )
    }

    if (viewMode === VIEW_MODES.CARD) {
      return (
        <ModelCardGrid
          models={filteredModels}
          onModelClick={handleModelClick}
          tokenUnit={tokenUnit}
          selectedGroup={groupFilter}
        />
      )
    }

    return (
      <PricingTable
        models={filteredModels}
        tokenUnit={tokenUnit}
        selectedGroup={groupFilter}
        onModelClick={handleModelClick}
      />
    )
  }

  if (isLoading) {
    return (
      <PublicLayout showMainContainer={false}>
        <div className='mx-auto w-full max-w-[1800px] px-4 pt-24 pb-10 sm:px-6 sm:pt-28 sm:pb-16 xl:px-8'>
          <LoadingSkeleton viewMode={viewMode} />
        </div>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <div
          aria-hidden='true'
          className='pointer-events-none absolute inset-x-0 top-0 h-[28rem] overflow-hidden'
        >
          <BrandGlow className='opacity-70' />
        </div>
        <PageTransition className='relative mx-auto w-full max-w-[1800px] px-4 pt-24 pb-10 sm:px-6 sm:pt-28 sm:pb-16 xl:px-8'>
          <main className='min-w-0 space-y-5'>
            <header className='flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-2'>
              <div className='max-w-2xl min-w-0'>
                <h1 className='text-foreground text-2xl font-semibold tracking-tight sm:text-3xl'>
                  {t('Model Hub')}
                </h1>
                <p className='text-muted-foreground mt-2 text-sm leading-relaxed text-pretty sm:text-base'>
                  {t(
                    'Browse capabilities, pricing, and context length in Model Hub, then copy the model name to call.'
                  )}
                </p>
              </div>
              {(models?.length ?? 0) > 0 && (
                <dl className='flex shrink-0 items-center gap-6'>
                  <div className='flex flex-col-reverse'>
                    <dt className='text-muted-foreground text-xs'>
                      {t('Models')}
                    </dt>
                    <dd className='text-xl font-semibold tracking-tight tabular-nums'>
                      {models?.length}
                    </dd>
                  </div>
                  <div className='flex flex-col-reverse'>
                    <dt className='text-muted-foreground text-xs'>
                      {t('Providers')}
                    </dt>
                    <dd className='text-xl font-semibold tracking-tight tabular-nums'>
                      {vendorCount}
                    </dd>
                  </div>
                </dl>
              )}
            </header>
            <PricingToolbar
              filteredCount={filteredModels.length}
              totalCount={models?.length}
              searchValue={searchInput}
              onSearchChange={setSearchInput}
              onSearchClear={clearSearch}
              sortBy={sortBy}
              onSortChange={setSortBy}
              tokenUnit={tokenUnit}
              onTokenUnitChange={setTokenUnit}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              quotaTypeFilter={quotaTypeFilter}
              endpointTypeFilter={endpointTypeFilter}
              vendorFilter={vendorFilter}
              groupFilter={groupFilter}
              tagFilter={tagFilter}
              onQuotaTypeChange={setQuotaTypeFilter}
              onEndpointTypeChange={setEndpointTypeFilter}
              onVendorChange={setVendorFilter}
              onGroupChange={setGroupFilter}
              onTagChange={setTagFilter}
              vendors={vendors || []}
              groups={availableGroups}
              groupRatios={groupRatio}
              tags={availableTags}
              models={models || []}
              integrationProfiles={integrationProfiles}
              hasActiveFilters={hasActiveFilters}
              activeFilterCount={activeFilterCount}
              onClearFilters={clearFilters}
            />

            {renderPricingContent()}
          </main>

          {selectedModel && (
            <ModelDetailsDrawer
              open={Boolean(selectedModel)}
              onOpenChange={(open) => {
                if (!open) setSelectedModelName(null)
              }}
              model={selectedModel}
              groupRatio={groupRatio || {}}
              usableGroup={usableGroup || {}}
              endpointMap={
                (endpointMap as Record<
                  string,
                  { path?: string; method?: string }
                >) || {}
              }
              integrationProfiles={integrationProfiles}
              autoGroups={autoGroups || []}
              tokenUnit={tokenUnit}
            />
          )}
        </PageTransition>
      </div>
    </PublicLayout>
  )
}
