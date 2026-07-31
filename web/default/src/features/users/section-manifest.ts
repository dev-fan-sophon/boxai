/**
 * Route-facing section metadata for the user operations workspace.
 *
 * TanStack Router only code-splits a route's `component`; `beforeLoad` stays in
 * the entry bundle. Keeping the section ids free of component imports therefore
 * prevents the analytics panels from landing in the JavaScript every anonymous
 * visitor downloads.
 */
export const USERS_SECTION_IDS = [
  'overview',
  'directory',
  'revenue',
  'acquisition',
  'segments',
] as const

export type UsersSectionId = (typeof USERS_SECTION_IDS)[number]

export const USERS_DEFAULT_SECTION: UsersSectionId = 'overview'
