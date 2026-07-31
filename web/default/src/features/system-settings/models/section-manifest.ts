/**
 * Route-facing section metadata, kept free of component imports.
 *
 * TanStack Router only code-splits a route's `component`; `beforeLoad` stays in
 * the entry bundle. Importing the section registry here would therefore drag
 * every settings panel into the JavaScript every anonymous visitor downloads.
 */
export const MODELS_SECTION_IDS = [
  'global',
  'routing-reliability',
  'gemini',
  'claude',
  'grok',
  'channel-affinity',
  'model-deployment',
] as const

export type ModelSectionId = (typeof MODELS_SECTION_IDS)[number]

export const MODELS_DEFAULT_SECTION: ModelSectionId = 'global'
