/**
 * Route-facing section metadata, kept free of component imports.
 *
 * TanStack Router only code-splits a route's `component`; `beforeLoad` stays in
 * the entry bundle. Importing the section registry here would therefore drag
 * every settings panel into the JavaScript every anonymous visitor downloads.
 */
export const AUTH_SECTION_IDS = [
  'basic-auth',
  'oauth',
  'passkey',
  'bot-protection',
  'custom-oauth',
] as const

export type AuthSectionId = (typeof AUTH_SECTION_IDS)[number]

export const AUTH_DEFAULT_SECTION: AuthSectionId = 'basic-auth'
