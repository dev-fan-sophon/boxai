/**
 * Product docs IA metadata (source of truth for section chrome).
 * Page bodies live in Markdown under content/docs/{en,vi} and are compiled by
 * scripts/docs/build-content.mjs — see docs/product-docs-system.md.
 */

export type DocsSectionId =
  | 'start'
  | 'console'
  | 'api'
  | 'clients'
  | 'playground'
  | 'concepts'
  | 'admin'

export type DocsRailId = 'website' | 'api' | 'clients' | 'playground'

export const DOCS_SECTIONS: Array<{
  id: DocsSectionId
  titleKey: string
  order: number
}> = [
  { id: 'start', titleKey: 'Get started', order: 10 },
  { id: 'console', titleKey: 'Console', order: 20 },
  { id: 'api', titleKey: 'API', order: 30 },
  { id: 'clients', titleKey: 'Clients', order: 40 },
  { id: 'playground', titleKey: 'Playground', order: 50 },
  { id: 'concepts', titleKey: 'Concepts', order: 60 },
  { id: 'admin', titleKey: 'Admin', order: 70 },
]

export const DOCS_RAILS: Array<{
  id: DocsRailId
  titleKey: string
  summaryKey: string
  href: string
}> = [
  {
    id: 'website',
    titleKey: 'Use the website',
    summaryKey: 'Create a key, top up, and manage usage in the console.',
    href: '/docs/start/getting-started',
  },
  {
    id: 'api',
    titleKey: 'Integrate the API',
    summaryKey: 'Call the gateway with OpenAI-compatible and other protocols.',
    href: '/docs/api/overview',
  },
  {
    id: 'clients',
    titleKey: 'Install clients',
    summaryKey: 'BoxAI Desktop, Connect, and third-party apps.',
    href: '/docs/clients/desktop',
  },
  {
    id: 'playground',
    titleKey: 'Playground',
    summaryKey: 'Chat and tools in the browser without writing code first.',
    href: '/docs/playground/overview',
  },
]

/** Paths (without locale /docs prefix) that must ship with a vi translation. */
export const DOCS_CORE_PATHS = [
  'start/what-is-boxai',
  'start/getting-started',
  'start/first-request',
  'console/api-keys',
  'console/model-hub',
  'console/billing-topup',
  'console/usage-logs',
  'api/overview',
  'api/auth',
  'api/streaming',
  'api/errors',
  'clients/desktop',
  'playground/overview',
  'concepts/models-groups-quota',
] as const
