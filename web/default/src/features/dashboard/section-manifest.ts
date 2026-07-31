/**
 * Route-facing section metadata, kept free of component imports.
 *
 * TanStack Router only code-splits a route's `component`; `beforeLoad` stays in
 * the entry bundle. Importing the section registry here would therefore drag
 * every settings panel into the JavaScript every anonymous visitor downloads.
 */
export const DASHBOARD_SECTION_IDS = [
  'overview',
  'models',
  'flow',
  'users',
  'connect',
  'desktop',
] as const

export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number]

/** Sections that are analytics views, and therefore also valid site-wide. */
export const DASHBOARD_ANALYTICS_SECTION_IDS = [
  'models',
  'flow',
  'users',
] as const

export const DASHBOARD_DEFAULT_SECTION: DashboardSectionId = 'overview'
