/**
 * Attachment classification and browser-side reading of plain-text files.
 * Binary documents (PDF/Word/Excel/PowerPoint) are parsed server-side; see
 * document-parse.ts.
 */

export const MAX_DOCUMENT_TEXT_CHARS = 60_000

const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|log|xml|ya?ml|html?)$/i

const SERVER_DOCUMENT_EXTENSIONS = /\.(pdf|docx|xlsx|pptx)$/i

const SERVER_DOCUMENT_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

export const DOCUMENT_ACCEPT = [
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.log',
  '.xml',
  '.yaml',
  '.yml',
  '.html',
  '.htm',
].join(',')

/** Binary document that goes through the server-side parse pipeline. */
export function isServerParsedDocument(file: File): boolean {
  return (
    SERVER_DOCUMENT_MIMES.has(file.type) ||
    SERVER_DOCUMENT_EXTENSIONS.test(file.name)
  )
}

/** Plain-text file read directly in the browser. */
export function isTextDocumentFile(file: File): boolean {
  return TEXT_EXTENSIONS.test(file.name) || file.type.startsWith('text/')
}

export function truncateDocumentText(text: string): string {
  const normalized = text.replaceAll('\r\n', '\n').trim()
  if (normalized.length <= MAX_DOCUMENT_TEXT_CHARS) return normalized
  return `${normalized.slice(0, MAX_DOCUMENT_TEXT_CHARS)}\n…[truncated]`
}

/** Read a plain-text attachment, truncated for prompts. */
export async function readTextDocument(file: File): Promise<string> {
  return truncateDocumentText(await file.text())
}
