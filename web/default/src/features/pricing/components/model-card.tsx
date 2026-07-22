/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Link } from '@tanstack/react-router'
import { ChevronRight, Copy, Play } from 'lucide-react'
import { memo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ModelBrandIcon } from '@/features/playground/components/catalog/model-brand-icon'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/utils'

import { DEFAULT_TOKEN_UNIT } from '../constants'
import {
  getDynamicDisplayGroupRatio,
  getDynamicPricingSummary,
} from '../lib/dynamic-price'
import { getGroupSavingsPercent, isTokenBasedModel } from '../lib/model-helpers'
import { canTryInPlayground } from '../lib/playground-eligibility'
import { formatPrice, formatRequestPrice } from '../lib/price'
import type { PricingModel, TokenUnit } from '../types'
import type { ModelPerfBadgeData } from './model-perf-badge'

export interface ModelCardProps {
  model: PricingModel
  onClick: () => void
  priceRate?: number
  usdExchangeRate?: number
  tokenUnit?: TokenUnit
  showRechargePrice?: boolean
  selectedGroup?: string
  perf?: ModelPerfBadgeData
}

function isRecentlyReleased(model: PricingModel): boolean {
  const raw = model.release_date
  if (!raw) return false
  const ts = Date.parse(raw)
  if (!Number.isFinite(ts)) return false
  const days = (Date.now() - ts) / (1000 * 60 * 60 * 24)
  return days >= 0 && days <= 30
}

/**
 * Apilio-style Model Hub card: name, capability tags, unit price, group, details.
 * All prices come from /api/pricing fields via formatPrice helpers — no mock rates.
 */
export const ModelCard = memo(function ModelCard(props: ModelCardProps) {
  const { t } = useTranslation()
  const { copyToClipboard } = useCopyToClipboard()
  const tokenUnit = props.tokenUnit ?? DEFAULT_TOKEN_UNIT
  const priceRate = props.priceRate ?? 1
  const usdExchangeRate = props.usdExchangeRate ?? 1
  const showRechargePrice = props.showRechargePrice ?? false
  const isTokenBased = isTokenBasedModel(props.model)
  const tokenUnitLabel = tokenUnit === 'K' ? t('/K tokens') : t('/M tokens')
  const metadata = [
    ...(props.model.input_modalities ?? []),
    ...(props.model.output_modalities ?? []),
    ...(props.model.capabilities ?? []),
  ].slice(0, 3)
  const groups = props.model.enable_groups || []
  const isNew = isRecentlyReleased(props.model)
  const isDynamicPricing =
    props.model.billing_mode === 'tiered_expr' &&
    Boolean(props.model.billing_expr)
  const dynamicSummary = isDynamicPricing
    ? getDynamicPricingSummary(props.model, {
        tokenUnit,
        showRechargePrice,
        priceRate,
        usdExchangeRate,
        groupRatioMultiplier: getDynamicDisplayGroupRatio(
          props.model,
          props.selectedGroup
        ),
      })
    : null

  const savingsPercent = getGroupSavingsPercent(
    props.model,
    props.selectedGroup
  )

  const handleCopy = () => {
    copyToClipboard(props.model.model_name || '')
  }

  let priceLine: ReactNode
  if (dynamicSummary) {
    if (dynamicSummary.isSpecialExpression) {
      priceLine = (
        <span className='text-amber-700 dark:text-amber-300'>
          {t('Special billing expression')}
        </span>
      )
    } else if (dynamicSummary.primaryEntries[0]) {
      const entry = dynamicSummary.primaryEntries[0]
      priceLine = (
        <>
          <span className='text-foreground font-mono text-base font-semibold tabular-nums'>
            {entry.formatted}
          </span>
          <span className='text-muted-foreground text-xs'>
            {t(entry.shortLabel)}
          </span>
        </>
      )
    } else {
      priceLine = (
        <span className='text-muted-foreground text-sm'>
          {t('Dynamic Pricing')}
        </span>
      )
    }
  } else if (isTokenBased) {
    priceLine = (
      <div className='flex flex-wrap gap-x-3 gap-y-1'>
        <span className='text-xs'>
          <span className='text-muted-foreground'>{t('Input')} </span>
          <strong className='text-foreground font-mono text-sm tabular-nums'>
            {formatPrice(
              props.model,
              'input',
              tokenUnit,
              showRechargePrice,
              priceRate,
              usdExchangeRate,
              props.selectedGroup
            )}
          </strong>
        </span>
        <span className='text-xs'>
          <span className='text-muted-foreground'>{t('Output')} </span>
          <strong className='text-foreground font-mono text-sm tabular-nums'>
            {formatPrice(
              props.model,
              'output',
              tokenUnit,
              showRechargePrice,
              priceRate,
              usdExchangeRate,
              props.selectedGroup
            )}
          </strong>
        </span>
        <span className='text-muted-foreground text-xs'>{tokenUnitLabel}</span>
      </div>
    )
  } else {
    priceLine = (
      <>
        <span className='text-foreground font-mono text-base font-semibold tabular-nums'>
          {formatRequestPrice(
            props.model,
            showRechargePrice,
            priceRate,
            usdExchangeRate,
            props.selectedGroup
          )}
        </span>
        <span className='text-muted-foreground text-xs'>/ {t('request')}</span>
      </>
    )
  }

  return (
    <article
      className={cn(
        'group bg-card hover:bg-muted/30 focus-visible:ring-ring relative flex w-full flex-col rounded-xl border p-3.5 text-left transition-colors sm:p-4',
        'focus-visible:ring-2 focus-visible:outline-none'
      )}
    >
      <div className='flex items-start justify-between gap-2'>
        <ModelBrandIcon
          modelName={props.model.model_name}
          icon={props.model.icon}
          vendorIcon={props.model.vendor_icon}
          size={24}
        />
        <div className='min-w-0 flex-1'>
          {props.model.vendor_name && (
            <p className='text-muted-foreground mb-1 text-[11px] font-medium'>
              {props.model.vendor_name}
            </p>
          )}
          <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
            {isNew && (
              <span className='bg-primary/10 text-primary inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase'>
                {t('NEW')}
              </span>
            )}
            <h3 className='text-foreground truncate text-sm leading-tight font-semibold sm:text-[15px]'>
              {props.model.display_name || props.model.model_name}
            </h3>
          </div>

          <div className='text-muted-foreground mt-1 flex items-center gap-1 font-mono text-xs'>
            <span className='truncate'>{props.model.model_name}</span>
          </div>
          {metadata.length > 0 && (
            <div className='mt-1.5 flex flex-wrap gap-1'>
              {metadata.map((tag) => (
                <span
                  key={tag}
                  className='bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-[11px]'
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          type='button'
          onClick={handleCopy}
          className='text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-7 shrink-0 items-center justify-center rounded-md border opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
          title={t('Copy')}
          aria-label={t('Copy model name')}
        >
          <Copy className='size-3.5' />
        </button>
      </div>

      {props.model.description && (
        <p className='text-muted-foreground mt-2 line-clamp-1 text-xs'>
          {props.model.description}
        </p>
      )}

      <div className='mt-3 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5'>
        {priceLine}
        {groups.length > 0 && (
          <span className='text-muted-foreground text-xs'>
            ·{' '}
            {props.selectedGroup && groups.includes(props.selectedGroup)
              ? props.selectedGroup
              : t('Available in {{count}} groups', { count: groups.length })}
          </span>
        )}
        {savingsPercent != null && (
          <span className='inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300'>
            {t('{{percent}}% off', { percent: savingsPercent })}
          </span>
        )}
      </div>

      {props.perf && Number.isFinite(props.perf.success_rate) && (
        <p className='text-muted-foreground mt-1.5 font-mono text-[11px] tabular-nums'>
          {t('Availability')} {props.perf.success_rate.toFixed(2)}%
        </p>
      )}

      <div className='mt-3 flex flex-wrap items-center gap-2 text-xs font-medium'>
        {canTryInPlayground(props.model) && (
          <Link
            to='/playground'
            search={{ model: props.model.model_name }}
            className='bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-md px-2.5 py-1.5'
          >
            <Play className='size-3' />
            {t('Try')}
          </Link>
        )}
        <Link
          to='/pricing/$modelId'
          params={{ modelId: props.model.model_name }}
          search={{ tab: 'integration' }}
          className='hover:bg-muted rounded-md border px-2.5 py-1.5'
        >
          {t('Integration guide')}
        </Link>
        <button
          type='button'
          onClick={props.onClick}
          className='hover:bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-1.5'
        >
          {t('Details')}
          <ChevronRight className='size-3.5' />
        </button>
      </div>
    </article>
  )
})
