import { Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { PricingModel } from '@/features/pricing/types'
import { formatCurrencyFromUSD } from '@/lib/currency'
import { cn } from '@/lib/utils'

import type { PlaygroundEstimateResult } from '@/features/playground/api'
import {
  useCostEstimate,
  type CostEstimateParams,
} from '../../hooks/use-cost-estimate'
import { buildPriceHint, type PriceHint } from '@/features/playground/lib/workbench/price-hint'

type PriceHintBadgeProps = {
  model?: PricingModel
  group: string
  groupRatio?: number
  className?: string
  /** Results in the pending submit; the estimate is the batch total. */
  jobCount?: number
  /** When set, debounced server estimate is preferred over catalog-only hint */
  estimateParams?: CostEstimateParams
}

export function PriceHintBadge(props: PriceHintBadgeProps) {
  const { t } = useTranslation()
  const catalogHint = buildPriceHint(props.model, props.group, props.groupRatio)
  const estimateQuery = useCostEstimate({
    modelName: props.model?.model_name,
    group: props.group,
    params: props.estimateParams,
  })

  const hint = mergeEstimate(catalogHint, estimateQuery.data)

  const batchTotal =
    (props.jobCount ?? 1) > 1 && hint.kind === 'per_request' && hint.amountLabel
  const label = batchTotal
    ? t('{{amount}} for {{count}}', {
        amount: hint.amountLabel,
        count: props.jobCount,
      })
    : formatHintLabel(hint, t)

  return (
    <span
      className={cn(
        // Stay in the footer flow — never absolute/float over the textarea.
        'relative z-10 inline-flex max-w-[9.5rem] shrink-0 items-center gap-1 truncate rounded-md bg-warning/10 px-2 py-0.5 text-2xs leading-none font-medium text-warning ring-1 ring-warning/20 sm:max-w-[14rem]',
        props.className
      )}
      title={formatHintTitle(hint, t)}
    >
      <Zap className='size-3 shrink-0 fill-current' aria-hidden='true' />
      <span className='truncate'>{label}</span>
    </span>
  )
}

function mergeEstimate(
  catalog: PriceHint,
  estimate: PlaygroundEstimateResult | null | undefined
): PriceHint {
  if (!estimate) return catalog
  const amountLabel = formatEstimateAmount(estimate)
  if (estimate.kind === 'per_request' && amountLabel) {
    return {
      kind: 'per_request',
      labelKey: 'per run',
      amountLabel,
      groupRatio: estimate.group_ratio,
    }
  }
  if (estimate.kind === 'token') {
    return {
      kind: 'token',
      labelKey: 'Token billing',
      amountLabel,
      groupRatio: estimate.group_ratio,
    }
  }
  return catalog
}

function formatEstimateAmount(
  estimate: PlaygroundEstimateResult
): string | undefined {
  if (typeof estimate.amount === 'number' && Number.isFinite(estimate.amount)) {
    return formatCurrencyFromUSD(estimate.amount, {
      digitsLarge: 4,
      digitsSmall: 4,
      abbreviate: false,
    })
  }
  return estimate.amount_label
}

function formatHintLabel(hint: PriceHint, t: (key: string) => string): string {
  if (hint.kind === 'per_request' && hint.amountLabel) {
    return `${hint.amountLabel}/${t('run')}`
  }
  if (hint.amountLabel && hint.kind === 'token') {
    return `${t(hint.labelKey)} ${hint.amountLabel}`
  }
  if (hint.amountLabel && hint.kind === 'group') {
    return `${t(hint.labelKey)} ${hint.amountLabel}`
  }
  return t(hint.labelKey)
}

function formatHintTitle(hint: PriceHint, t: (key: string) => string): string {
  if (hint.kind === 'per_request') {
    return t('Estimated per-request price from catalog (group-adjusted)')
  }
  return t('Billed by tokens or group ratio from catalog')
}
