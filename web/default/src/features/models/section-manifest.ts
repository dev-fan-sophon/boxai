/**
 * Route-facing section metadata, kept free of component imports.
 *
 * TanStack Router only code-splits a route's `component`; `beforeLoad` stays in
 * the entry bundle. Importing the section registry here would therefore drag
 * every settings panel into the JavaScript every anonymous visitor downloads.
 */
export const MODELS_SECTION_IDS = ['metadata', 'deployments'] as const

export type ModelsSectionId = (typeof MODELS_SECTION_IDS)[number]

export const MODELS_DEFAULT_SECTION: ModelsSectionId = 'metadata'
