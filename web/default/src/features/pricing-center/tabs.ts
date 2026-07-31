/**
 * Route-facing tab metadata, kept free of component imports so route
 * `beforeLoad` guards do not pull tab panels into the entry bundle.
 */
export const PRICING_CENTER_TABS = [
  'models',
  'subscriptions',
  'groups',
  'currency',
  'payments',
] as const

export type PricingCenterTab = (typeof PRICING_CENTER_TABS)[number]

export const PRICING_CENTER_DEFAULT_TAB: PricingCenterTab = 'models'

export function isPricingCenterTab(value: string): value is PricingCenterTab {
  return (PRICING_CENTER_TABS as readonly string[]).includes(value)
}

export const PRICING_CENTER_TAB_TITLE_KEYS: Record<PricingCenterTab, string> = {
  models: 'Model Pricing',
  subscriptions: 'Subscriptions',
  groups: 'Groups & Tools',
  currency: 'Currency & Display',
  payments: 'Payment Gateway',
}
