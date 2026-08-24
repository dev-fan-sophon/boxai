import { describe, expect, it } from 'vitest'

import { formatSeoTitle, isPrivateSeoPath, resolveRouteSeo } from './seo'

describe('formatSeoTitle', () => {
  it('joins page and site name', () => {
    expect(formatSeoTitle('Pricing', 'BoxAI')).toBe('Pricing | BoxAI')
  })

  it('returns site name alone for bare brand title', () => {
    expect(formatSeoTitle('BoxAI', 'BoxAI')).toBe('BoxAI')
    expect(formatSeoTitle('', 'BoxAI')).toBe('BoxAI')
  })
})

describe('formatSeoDocumentTitle', () => {
  it('builds homepage title with host', async () => {
    const { formatSeoDocumentTitle } = await import('./seo')
    expect(
      formatSeoDocumentTitle('/', 'BoxAI', 'BoxAI', 'https://you-box.com')
    ).toBe('BoxAI · Unified AI API Gateway | you-box.com')
    expect(formatSeoDocumentTitle('/pricing', 'Model Pricing', 'BoxAI')).toBe(
      'Model Pricing | BoxAI'
    )
  })
})

describe('isPrivateSeoPath', () => {
  it('marks console and auth routes private', () => {
    expect(isPrivateSeoPath('/console')).toBe(true)
    expect(isPrivateSeoPath('/console/token')).toBe(true)
    expect(isPrivateSeoPath('/sign-in')).toBe(true)
    expect(isPrivateSeoPath('/playground/')).toBe(true)
  })

  it('keeps marketing routes public', () => {
    expect(isPrivateSeoPath('/')).toBe(false)
    expect(isPrivateSeoPath('/pricing')).toBe(false)
    expect(isPrivateSeoPath('/docs/getting-started')).toBe(false)
    expect(isPrivateSeoPath('/docs/start/getting-started')).toBe(false)
    expect(isPrivateSeoPath('/connect')).toBe(false)
  })
})

describe('resolveRouteSeo', () => {
  it('resolves pricing and private defaults', () => {
    const pricing = resolveRouteSeo('/pricing/', 'BoxAI')
    expect(pricing.title).toBe('Model Pricing')
    expect(pricing.noindex).toBeFalsy()

    const connect = resolveRouteSeo('/connect', 'BoxAI')
    expect(connect.title).toBe('BoxAI Connect')
    expect(connect.noindex).toBe(false)

    const consoleSeo = resolveRouteSeo('/console/log', 'BoxAI')
    expect(consoleSeo.noindex).toBe(true)
  })

  it('builds model detail titles', () => {
    const seo = resolveRouteSeo('/pricing/gpt-4o', 'BoxAI')
    expect(seo.title).toContain('gpt-4o')
  })

  it('resolves nested product docs paths', () => {
    const docsHome = resolveRouteSeo('/docs', 'BoxAI')
    expect(docsHome.title).toBe('Documentation')

    const nested = resolveRouteSeo('/docs/start/getting-started', 'BoxAI')
    expect(nested.title).toMatch(/Getting Started/i)
    expect(nested.noindex).toBeFalsy()
  })
})
