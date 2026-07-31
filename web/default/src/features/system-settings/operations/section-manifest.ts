/**
 * Route-facing section metadata, kept free of component imports.
 *
 * TanStack Router only code-splits a route's `component`; `beforeLoad` stays in
 * the entry bundle. Importing the section registry here would therefore drag
 * every settings panel into the JavaScript every anonymous visitor downloads.
 */
export const OPERATIONS_SECTION_IDS = [
  'behavior',
  'alerts',
  'email',
  'worker',
  'logs',
  'performance',
  'update-checker',
] as const

export type OperationsSectionId = (typeof OPERATIONS_SECTION_IDS)[number]

export const OPERATIONS_DEFAULT_SECTION: OperationsSectionId = 'behavior'
