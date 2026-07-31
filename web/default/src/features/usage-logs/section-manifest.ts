/**
 * Route-facing section metadata, kept free of component imports.
 *
 * TanStack Router only code-splits a route's `component`; `beforeLoad` stays in
 * the entry bundle. Importing the section registry here would therefore drag
 * every settings panel into the JavaScript every anonymous visitor downloads.
 */
export const USAGE_LOGS_SECTION_IDS = ['common', 'drawing', 'task'] as const

export type UsageLogsSectionId = (typeof USAGE_LOGS_SECTION_IDS)[number]

export const USAGE_LOGS_DEFAULT_SECTION: UsageLogsSectionId = 'common'

/** Type guard for validating section IDs without casting. Use with z.string().refine() or params checks. */
export function isUsageLogsSectionId(s: string): s is UsageLogsSectionId {
  return (USAGE_LOGS_SECTION_IDS as readonly string[]).includes(s)
}
