/** Legacy flat /docs/$slug → nested paths. */
export const DOCS_LEGACY_REDIRECTS: Record<string, string> = {
  'what-is-boxai': 'start/what-is-boxai',
  'getting-started': 'start/getting-started',
  streaming: 'api/streaming',
  errors: 'api/errors',
}

export function resolveDocsLegacyPath(docPath: string): string | null {
  const normalized = docPath.replaceAll(/^\/+|\/+$/g, '')
  if (!normalized) return null
  return DOCS_LEGACY_REDIRECTS[normalized] ?? null
}
