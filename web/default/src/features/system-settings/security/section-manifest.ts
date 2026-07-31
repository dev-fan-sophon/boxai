/**
 * Route-facing section metadata, kept free of component imports.
 *
 * TanStack Router only code-splits a route's `component`; `beforeLoad` stays in
 * the entry bundle. Importing the section registry here would therefore drag
 * every settings panel into the JavaScript every anonymous visitor downloads.
 */
export const SECURITY_SECTION_IDS = [
  'rate-limit',
  'route-throttling',
  'trusted-proxies',
  'edge-protection',
  'sensitive-words',
  'ssrf',
  'token-limits',
] as const

export type SecuritySectionId = (typeof SECURITY_SECTION_IDS)[number]

export const SECURITY_DEFAULT_SECTION: SecuritySectionId = 'rate-limit'
