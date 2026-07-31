/**
 * Route-facing section metadata, kept free of component imports.
 *
 * TanStack Router only code-splits a route's `component`; `beforeLoad` stays in
 * the entry bundle. Importing the section registry here would therefore drag
 * every settings panel into the JavaScript every anonymous visitor downloads.
 */
export const CONTENT_SECTION_IDS = [
  'dashboard',
  'announcements',
  'api-info',
  'faq',
  'uptime-kuma',
  'chat',
  'drawing',
] as const

export type ContentSectionId = (typeof CONTENT_SECTION_IDS)[number]

export const CONTENT_DEFAULT_SECTION: ContentSectionId = 'dashboard'
