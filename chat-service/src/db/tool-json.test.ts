import { describe, expect, test } from 'bun:test'

import { encodeLegacyToolJson } from './tool-json'

describe('encodeLegacyToolJson', () => {
  test('web search turn produces sources and a completed card', () => {
    const encoded = encodeLegacyToolJson([
      { type: 'step-start' },
      {
        type: 'tool-web_search',
        state: 'output-available',
        output: {
          text: 'answer',
          sources: [
            { href: 'https://a.example', title: 'A', domain: 'a.example' },
            { href: '', title: 'dropped' },
          ],
        },
      },
      { type: 'text', text: 'final answer' },
    ])
    expect(JSON.parse(encoded)).toEqual({
      managedTool: { action: 'web_search', status: 'completed' },
      sources: [{ href: 'https://a.example', title: 'A', domain: 'a.example' }],
    })
  })

  test('document turn maps artifacts and verification flags', () => {
    const encoded = encodeLegacyToolJson([
      {
        type: 'tool-generate_document',
        state: 'output-available',
        output: {
          documents: [
            {
              asset_id: 7,
              name: 'report.pdf',
              url: '/api/playground/assets/7/content',
              mime: 'application/pdf',
              size: 1234,
            },
            { asset_id: 8, name: 'data.xlsx', mime: 'application/x', size: 5 },
          ],
          attempts: 2,
          unverified: ['data.xlsx'],
        },
      },
    ])
    const parsed = JSON.parse(encoded)
    expect(parsed.managedTool.action).toBe('generate_document')
    expect(parsed.managedTool.documentAttempts).toBe(2)
    expect(parsed.managedTool.documents).toEqual([
      {
        assetId: 7,
        name: 'report.pdf',
        url: '/api/playground/assets/7/content',
        mime: 'application/pdf',
        size: 1234,
        verified: true,
      },
      {
        assetId: 8,
        name: 'data.xlsx',
        url: undefined,
        mime: 'application/x',
        size: 5,
        verified: false,
      },
    ])
  })

  test('failed tool becomes a failed card with the error text', () => {
    const parsed = JSON.parse(
      encodeLegacyToolJson([
        {
          type: 'tool-generate_image',
          state: 'output-error',
          errorText: 'quota exceeded',
        },
      ])
    )
    expect(parsed.managedTool).toEqual({
      action: 'generate_image',
      status: 'failed',
      error: 'quota exceeded',
    })
  })

  test('reasoning is captured and plain text turns encode to empty', () => {
    expect(encodeLegacyToolJson([{ type: 'text', text: 'hi' }])).toBe('')
    const parsed = JSON.parse(
      encodeLegacyToolJson([
        { type: 'reasoning', text: 'think a' },
        { type: 'reasoning', text: 'think b' },
      ])
    )
    expect(parsed.reasoning).toEqual({ content: 'think a\nthink b' })
  })

  test('last tool wins the card while search sources are kept', () => {
    const parsed = JSON.parse(
      encodeLegacyToolJson([
        {
          type: 'tool-web_search',
          state: 'output-available',
          output: { sources: [{ href: 'https://s.example', title: 'S' }] },
        },
        {
          type: 'tool-generate_document',
          state: 'output-available',
          output: { documents: [], attempts: 1 },
        },
      ])
    )
    expect(parsed.managedTool.action).toBe('generate_document')
    expect(parsed.sources).toHaveLength(1)
  })
})
