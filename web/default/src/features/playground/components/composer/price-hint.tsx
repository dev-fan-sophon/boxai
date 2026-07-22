/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'
import { Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PricingModel } from '@/features/pricing/types'
import { cn } from '@/lib/utils'

import {
  estimatePlaygroundCost,
  type PlaygroundEstimateResult,
} from '../../api'
import { buildPriceHint, type PriceHint } from '../../lib/workbench/price-hint'

type PriceHintBadgeProps = {
  model?: PricingModel
  group: string
  groupRatio?: number
  className?: string
  /** When set, debounced server estimate is preferred over catalog-only hint */
  estimateParams?: {
    modality: string
    n?: number
    size?: string
    duration?: number
    has_reference?: boolean
    max_tokens?: number
  }
}

export function PriceHintBadge(props: PriceHintBadgeProps) {
  const { t } = useTranslation()
  const catalogHint = buildPriceHint(props.model, props.group, props.groupRatio)
  const [debounced, setDebounced] = useState(props.estimateParams)
  const modelName = props.model?.model_name

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebounced(props.estimateParams)
    }, 350)
    return () => window.clearTimeout(handle)
  }, [props.estimateParams])

  const estimateQuery = useQuery({
    queryKey: ['playground', 'estimate', modelName, props.group, debounced],
    queryFn: () =>
      estimatePlaygroundCost({
        modality: debounced?.modality ?? 'chat',
        model: modelName ?? '',
        group: props.group,
        n: debounced?.n,
        size: debounced?.size,
        duration: debounced?.duration,
        has_reference: debounced?.has_reference,
        max_tokens: debounced?.max_tokens,
        // Rough display estimate; backend also defaults when omitted
        prompt_tokens: debounced?.modality === 'chat' ? 500 : undefined,
      }),
    enabled: Boolean(modelName && debounced),
    staleTime: 30_000,
  })

  const hint = mergeEstimate(catalogHint, estimateQuery.data)

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning ring-1 ring-warning/20',
        props.className
      )}
      title={formatHintTitle(hint, t)}
    >
      <Zap className='size-3 fill-current' aria-hidden='true' />
      <span>{formatHintLabel(hint, t)}</span>
    </span>
  )
}

function mergeEstimate(
  catalog: PriceHint,
  estimate: PlaygroundEstimateResult | null | undefined
): PriceHint {
  if (!estimate) return catalog
  if (estimate.kind === 'per_request' && estimate.amount_label) {
    return {
      kind: 'per_request',
      labelKey: 'per run',
      amountLabel: estimate.amount_label,
      groupRatio: estimate.group_ratio,
    }
  }
  if (estimate.kind === 'token') {
    return {
      kind: 'token',
      labelKey: 'Token billing',
      amountLabel: estimate.amount_label,
      groupRatio: estimate.group_ratio,
    }
  }
  return catalog
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
