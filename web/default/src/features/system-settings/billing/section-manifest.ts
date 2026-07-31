/**
 * Route-facing section metadata, kept free of component imports.
 *
 * TanStack Router only code-splits a route's `component`; `beforeLoad` stays in
 * the entry bundle. Importing the section registry here would therefore drag
 * every settings panel into the JavaScript every anonymous visitor downloads.
 */
export const BILLING_SECTION_IDS = ['quota', 'checkin', 'moved'] as const

export type BillingSectionId = (typeof BILLING_SECTION_IDS)[number]

export const BILLING_DEFAULT_SECTION: BillingSectionId = 'quota'

/**
 * Legacy billing section URLs relocated to the Pricing Center. Old deep links
 * redirect to the target tab; the `moved` section lists them until removal.
 */
export const BILLING_MOVED_SECTIONS: Record<string, string> = {
  currency: 'currency',
  'group-pricing': 'groups',
  'tool-pricing': 'groups',
  payment: 'payments',
  'model-pricing': 'models',
}
