/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { ManagedToolCard, Message, MessageSource } from '../types'

export function extractManagedSearchResult(response: unknown): {
  text: string
  sources: MessageSource[]
} {
  if (!response || typeof response !== 'object') {
    throw new Error('Search returned an empty answer')
  }
  const root = response as Record<string, unknown>
  if (root.status !== 'completed') {
    throw new Error('Search did not complete')
  }
  const output = Array.isArray(root.output) ? root.output : []
  const texts: string[] = []
  const candidates: Array<{ url?: unknown; title?: unknown }> = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : []
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const value = part as Record<string, unknown>
      if (value.type === 'output_text' && typeof value.text === 'string') {
        texts.push(value.text)
      }
      if (Array.isArray(value.annotations)) {
        candidates.push(
          ...(value.annotations as Array<Record<string, unknown>>)
        )
      }
    }
  }
  if (Array.isArray(root.citations)) {
    for (const citation of root.citations) {
      candidates.push(
        typeof citation === 'string'
          ? { url: citation }
          : (citation as Record<string, unknown>)
      )
    }
  }
  const text = texts.join('\n').trim()
  if (!text) throw new Error('Search returned an empty answer')
  const seen = new Set<string>()
  const sources: MessageSource[] = []
  for (const candidate of candidates) {
    const raw = candidate.url
    if (typeof raw !== 'string') continue
    try {
      const url = new URL(raw)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      url.hash = ''
      const href = url.toString()
      if (seen.has(href)) continue
      seen.add(href)
      sources.push({
        href,
        title:
          typeof candidate.title === 'string' && candidate.title.trim()
            ? candidate.title.trim()
            : url.hostname,
        domain: url.hostname,
      })
    } catch {
      // Ignore malformed and unsafe citations supplied by the upstream model.
    }
  }
  return { text, sources }
}

export function updateManagedAssistant(
  messages: Message[],
  assistantKey: string,
  managedTool: ManagedToolCard,
  sources?: MessageSource[],
  content?: string
): Message[] {
  return messages.map((message) =>
    message.key === assistantKey
      ? {
          ...message,
          managedTool,
          sources: sources ?? message.sources,
          versions: content
            ? message.versions.map((version, index) =>
                index === message.versions.length - 1
                  ? { ...version, content }
                  : version
              )
            : message.versions,
          status: managedTool.status === 'failed' ? 'error' : 'complete',
        }
      : message
  )
}
