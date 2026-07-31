import { ROLE } from '@/lib/roles'

/**
 * Route-facing tab metadata, kept free of component imports so route
 * `beforeLoad` guards do not pull tab panels into the entry bundle.
 *
 * Commerce tabs (redemption / topup-reviews) are admin+; pricing and payment
 * configuration tabs stay root-only so a regular admin cannot edit rates.
 */
export const PRICING_CENTER_TABS = [
  'models',
  'subscriptions',
  'groups',
  'currency',
  'payments',
  'redemption',
  'topup-reviews',
] as const

export type PricingCenterTab = (typeof PRICING_CENTER_TABS)[number]

/** Tabs any admin may open (commerce operations). */
export const PRICING_CENTER_ADMIN_TABS = [
  'redemption',
  'topup-reviews',
] as const satisfies readonly PricingCenterTab[]

export const PRICING_CENTER_DEFAULT_TAB: PricingCenterTab = 'models'

export const PRICING_CENTER_ADMIN_DEFAULT_TAB: PricingCenterTab = 'redemption'

export function isPricingCenterTab(value: string): value is PricingCenterTab {
  return (PRICING_CENTER_TABS as readonly string[]).includes(value)
}

export function canAccessPricingCenterTab(
  tab: PricingCenterTab,
  role: number | undefined
): boolean {
  if (role === undefined) return false
  if (role >= ROLE.SUPER_ADMIN) return true
  if (role < ROLE.ADMIN) return false
  return (PRICING_CENTER_ADMIN_TABS as readonly string[]).includes(tab)
}

export function defaultPricingCenterTab(
  role: number | undefined
): PricingCenterTab {
  if (role !== undefined && role >= ROLE.SUPER_ADMIN) {
    return PRICING_CENTER_DEFAULT_TAB
  }
  return PRICING_CENTER_ADMIN_DEFAULT_TAB
}

export const PRICING_CENTER_TAB_TITLE_KEYS: Record<PricingCenterTab, string> = {
  models: 'Model Pricing',
  subscriptions: 'Subscriptions',
  groups: 'Groups & Tools',
  currency: 'Currency & Display',
  payments: 'Payment Gateway',
  redemption: 'Redemption Codes',
  'topup-reviews': 'Top-up Reviews',
}
