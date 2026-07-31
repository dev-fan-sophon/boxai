/**
 * Route-facing section metadata, kept free of component imports.
 *
 * TanStack Router only code-splits a route's `component`; `beforeLoad` stays in
 * the entry bundle. Importing the section registry here would therefore drag
 * every settings panel into the JavaScript every anonymous visitor downloads.
 */
export const SITE_SECTION_IDS = [
  'system-info',
  'notice',
  'header-navigation',
  'sidebar-modules',
] as const

export type SiteSectionId = (typeof SITE_SECTION_IDS)[number]

export const SITE_DEFAULT_SECTION: SiteSectionId = 'system-info'
