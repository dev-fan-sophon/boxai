import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  normalizeReturnTarget,
  rewritePathlessBrowserPath,
} from './normalize-return-target'

afterEach(() => vi.unstubAllGlobals())

describe('normalizeReturnTarget', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    [
      '/desktop/authorize?request=abc#decision',
      '/desktop/authorize?request=abc#decision',
    ],
    ['/_authenticated/profile/', '/profile/'],
    ['/_authenticated/profile', '/profile'],
    ['/(auth)/sign-in', '/sign-in'],
    ['/(errors)/404', '/404'],
  ])('keeps an internal path', (target, expected) => {
    expect(normalizeReturnTarget(target)).toBe(expected)
  })

  it.each([
    undefined,
    '',
    '//evil.example/path',
    '/\\evil.example/path',
    '/path\nnext',
    'javascript:alert(1)',
    'data:text/html,hello',
    'https://evil.example/path',
  ])('falls back for unsafe target %s', (target) => {
    expect(normalizeReturnTarget(target)).toBe('/dashboard')
  })

  it('converts a same-origin absolute URL in the browser', () => {
    vi.stubGlobal('window', { location: { origin: 'https://box.example' } })
    expect(
      normalizeReturnTarget(
        'https://box.example/desktop/authorize?request=abc#ok'
      )
    ).toBe('/desktop/authorize?request=abc#ok')
  })
})

describe('rewritePathlessBrowserPath', () => {
  it.each([
    ['/_authenticated/profile/', '/profile/'],
    ['/_authenticated/profile', '/profile'],
    ['/(errors)/500', '/500'],
    ['/profile', null],
    ['/dashboard/models', null],
  ] as const)('rewrites %s → %s', (input, expected) => {
    expect(rewritePathlessBrowserPath(input)).toBe(expected)
  })
})
