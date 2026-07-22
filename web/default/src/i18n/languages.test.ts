import { describe, expect, it } from 'vitest'

import { normalizeInterfaceLanguage, toIntlLocale } from './languages'

describe('toIntlLocale', () => {
  it('maps the Vietnamese interface language to its explicit regional locale', () => {
    expect(toIntlLocale('vi')).toBe('vi-VN')
    expect(normalizeInterfaceLanguage('vi-VN')).toBe('vi')
    expect(normalizeInterfaceLanguage('vi_VN')).toBe('vi')
  })
})
