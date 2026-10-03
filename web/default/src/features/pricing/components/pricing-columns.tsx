import type { ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { BadgeListCell, DataTableColumnHeader } from '@/components/data-table'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import { LobeIcon } from '@/lib/lobe-icon'
import { MULTI_GROUP_ENABLED } from '@/lib/multi-group'

import { DEFAULT_TOKEN_UNIT } from '../constants'
import {
  getDynamicDisplayGroupRatio,
  getDynamicPricingSummary,
} from '../lib/dynamic-price'
import { parseTags } from '../lib/filters'
import { isPerSecondVideoModel, isTokenBasedModel } from '../lib/model-helpers'
import {
  formatPrice,
  formatRequestPrice,
  stripTrailingZeros,
} from '../lib/price'
import type { PricingModel, TokenUnit } from '../types'
import { ModelBillingModeBadge } from './model-billing-mode-badge'

// ----------------------------------------------------------------------------
// Pricing Table Columns
// ----------------------------------------------------------------------------

export interface PricingColumnsOptions {
  tokenUnit?: TokenUnit
  selectedGroup?: string
}

export function usePricingColumns(
  options: PricingColumnsOptions = {}
): ColumnDef<PricingModel>[] {
  const { t } = useTranslation()
  const { tokenUnit = DEFAULT_TOKEN_UNIT, selectedGroup } = options

  const tokenUnitLabel = tokenUnit === 'K' ? '1K' : '1M'

  return [
    // Model column
    {
      accessorKey: 'model_name',
      meta: { label: t('Model') },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Model')} />
      ),
      cell: ({ row }) => {
        const model = row.original
        const modelIconKey = model.icon || model.vendor_icon
        const modelIcon = modelIconKey ? (
          <LobeIcon name={modelIconKey} size={14} />
        ) : null

        return (
          <div className='flex max-w-full min-w-0 items-center gap-2.5'>
            {modelIcon && (
              <span className='bg-background ring-border/60 flex size-6 shrink-0 items-center justify-center rounded-md ring-1'>
                {modelIcon}
              </span>
            )}
            <span
              className='truncate font-mono text-sm font-medium'
              title={model.model_name}
            >
              {model.model_name}
            </span>
          </div>
        )
      },
      minSize: 200,
    },

    // Type column
    {
      accessorKey: 'quota_type',
      header: t('Type'),
      cell: ({ row }) => (
        <ModelBillingModeBadge model={row.original} className='-ml-1.5' />
      ),
      size: 150,
      enableSorting: false,
    },

    // Price column
    {
      accessorKey: 'price',
      meta: { label: t('Price') },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Price')} />
      ),
      cell: ({ row }) => {
        const model = row.original
        const dynamicSummary = getDynamicPricingSummary(model, {
          tokenUnit,
          groupRatioMultiplier: getDynamicDisplayGroupRatio(
            model,
            selectedGroup
          ),
        })

        if (dynamicSummary) {
          if (dynamicSummary.isSpecialExpression) {
            return (
              <div className='max-w-full min-w-0'>
                <div className='text-warning-subtle-foreground text-xs font-medium'>
                  {t('Special billing expression')}
                </div>
                <div className='text-muted-foreground text-2xs'>
                  {t('Unable to parse structured pricing')}
                </div>
                <code className='text-muted-foreground text-3xs mt-1 line-clamp-2 block font-mono leading-relaxed break-all'>
                  {dynamicSummary.rawExpression}
                </code>
              </div>
            )
          }

          const primaryEntries = dynamicSummary.primaryEntries.slice(0, 2)
          if (primaryEntries.length === 0) {
            return (
              <span className='text-muted-foreground text-xs'>
                {t('Dynamic Pricing')}
              </span>
            )
          }

          return (
            <div className='max-w-full min-w-0'>
              <span className='text-sm font-medium whitespace-nowrap tabular-nums'>
                {primaryEntries.map((entry, index) => (
                  <span key={entry.key}>
                    {index > 0 && (
                      <span className='text-muted-foreground mx-1'>/</span>
                    )}
                    {stripTrailingZeros(entry.formatted)}
                  </span>
                ))}
              </span>
              <div className='text-muted-foreground text-2xs'>
                / {tokenUnitLabel} {t('tokens')}
                {dynamicSummary.tierCount > 1 &&
                  ` · ${t('{{count}} tiers', {
                    count: dynamicSummary.tierCount,
                  })}`}
              </div>
            </div>
          )
        }

        const isTokenBased = isTokenBasedModel(model)

        if (isTokenBased) {
          const inputPrice = stripTrailingZeros(
            formatPrice(model, 'input', tokenUnit, selectedGroup)
          )
          const outputPrice = stripTrailingZeros(
            formatPrice(model, 'output', tokenUnit, selectedGroup)
          )

          return (
            <div className='max-w-full min-w-0'>
              <span className='text-sm font-medium whitespace-nowrap tabular-nums'>
                {inputPrice}
                <span className='text-muted-foreground mx-1'>/</span>
                {outputPrice}
              </span>
              <div className='text-muted-foreground text-2xs'>
                {t('Input')} / {t('Output')} · {tokenUnitLabel} {t('tokens')}
              </div>
            </div>
          )
        }

        const price = stripTrailingZeros(
          formatRequestPrice(model, selectedGroup)
        )

        return (
          <div className='max-w-full min-w-0'>
            <span className='text-sm font-medium whitespace-nowrap tabular-nums'>
              {price}
            </span>
            <div className='text-muted-foreground text-2xs'>
              / {isPerSecondVideoModel(model) ? t('second') : t('request')}
            </div>
          </div>
        )
      },
      size: 230,
      enableSorting: false,
    },

    // Cached price column (Vercel AI Gateway style)
    {
      id: 'cached_price',
      header: t('Cached'),
      cell: ({ row }) => {
        const model = row.original
        const dynamicSummary = getDynamicPricingSummary(model, {
          tokenUnit,
          groupRatioMultiplier: getDynamicDisplayGroupRatio(
            model,
            selectedGroup
          ),
        })

        if (dynamicSummary) {
          if (dynamicSummary.isSpecialExpression) {
            return (
              <span className='text-muted-foreground text-xs'>
                {t('Special billing expression')}
              </span>
            )
          }

          const cacheEntry = dynamicSummary.entries.find(
            (entry) => entry.field === 'cacheReadPrice'
          )
          if (!cacheEntry) {
            return <span className='text-muted-foreground text-xs'>—</span>
          }

          return (
            <div className='max-w-full min-w-0'>
              <span className='text-sm whitespace-nowrap tabular-nums'>
                {stripTrailingZeros(cacheEntry.formatted)}
              </span>
              <div className='text-muted-foreground text-2xs'>
                / {tokenUnitLabel}
              </div>
            </div>
          )
        }

        const isTokenBased = isTokenBasedModel(model)

        if (!isTokenBased || model.cache_ratio == null) {
          return <span className='text-muted-foreground text-xs'>—</span>
        }

        const cachedPrice = stripTrailingZeros(
          formatPrice(model, 'cache', tokenUnit, selectedGroup)
        )

        return (
          <div className='max-w-full min-w-0'>
            <span className='text-sm whitespace-nowrap tabular-nums'>
              {cachedPrice}
            </span>
            <div className='text-muted-foreground text-2xs'>
              / {tokenUnitLabel}
            </div>
          </div>
        )
      },
      size: 110,
      enableSorting: false,
    },

    // Vendor column
    {
      accessorKey: 'vendor_name',
      header: t('Vendor'),
      cell: ({ row }) => {
        const model = row.original
        if (!model.vendor_name) {
          return <span className='text-muted-foreground text-xs'>—</span>
        }
        return (
          <div className='flex min-w-0 items-center gap-2'>
            {model.vendor_icon && (
              <LobeIcon name={model.vendor_icon} size={14} />
            )}
            <span className='truncate text-sm' title={model.vendor_name}>
              {model.vendor_name}
            </span>
          </div>
        )
      },
      size: 130,
      enableSorting: false,
    },

    // Tags column
    {
      accessorKey: 'tags',
      header: t('Tags'),
      cell: ({ row }) => {
        const tags = parseTags(row.original.tags)
        return (
          <BadgeListCell
            items={tags.map((tag) => (
              <StatusBadge
                key={tag}
                label={tag}
                autoColor={tag}
                size='sm'
                copyable={false}
              />
            ))}
          />
        )
      },
      size: 140,
      enableSorting: false,
    },

    // Enable Groups column (only when multiple groups are offered)
    ...(MULTI_GROUP_ENABLED
      ? ([
          {
            accessorKey: 'enable_groups',
            header: t('Groups'),
            cell: ({ row }) => {
              const groups = row.original.enable_groups || []
              return (
                <BadgeListCell
                  items={groups.map((group) => (
                    <GroupBadge key={group} group={group} size='sm' />
                  ))}
                  tooltipClassName='max-w-[280px] p-2'
                />
              )
            },
            size: 130,
            enableSorting: false,
          },
        ] satisfies ColumnDef<PricingModel>[])
      : []),
  ]
}
