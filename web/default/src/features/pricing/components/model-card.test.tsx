import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { PricingModel } from '../types'
import { ModelCard } from './model-card'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/features/playground/components/catalog/model-brand-icon', () => ({
  ModelBrandIcon: () => null,
}))
vi.mock('@/lib/currency', () => ({
  formatBillingCurrencyFromUSD: (value: number) => `$${value}`,
}))

const model: PricingModel = {
  id: 65,
  model_name: 'gpt-6-astra',
  quota_type: 0,
  model_ratio: 0.775,
  completion_ratio: 5,
  enable_groups: ['default'],
  group_ratio: { default: 1 },
  billing_mode: 'tiered_expr',
  billing_expr:
    '(len <= 272000 ? tier("standard", p * 1.55 + c * 7.75 + cr * 0.155 + cc * 1.9375) : tier("long_context", p * 3.1 + c * 11.625 + cr * 0.31 + cc * 3.875)) * (param("service_tier") == "priority" ? 2 : 1)',
}

describe('ModelCard pricing', () => {
  it.each([
    ['M', ['$1.55', '$7.75', '$0.155', '$1.9375']],
    ['K', ['$0.00155', '$0.00775', '$0.000155', '$0.0019375']],
  ] as const)(
    'shows every standard-tier price per 1%s tokens',
    (tokenUnit, prices) => {
      const html = renderToStaticMarkup(
        createElement(ModelCard, { model, tokenUnit, onClick: () => {} })
      )
      for (const label of ['Input', 'Output', 'Cache Read', 'Cache Write']) {
        expect(html).toContain(`>${label}</span>`)
      }
      for (const price of prices) expect(html).toContain(`${price}<span`)
      expect(html.match(new RegExp(`/1${tokenUnit}`, 'g'))).toHaveLength(4)
      expect(html).toContain('Dynamic Pricing')
    }
  )

  it('does not present fallback ratio prices for an unparseable expression', () => {
    const html = renderToStaticMarkup(
      createElement(ModelCard, {
        model: { ...model, billing_expr: 'p * param("price")' },
        onClick: () => {},
      })
    )
    expect(html).toContain('Special billing expression')
    expect(html).not.toContain('$1.55')
  })
})
