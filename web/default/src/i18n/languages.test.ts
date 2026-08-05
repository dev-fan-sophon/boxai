import { describe, expect, it } from 'vitest'

import { normalizeInterfaceLanguage, toIntlLocale } from './languages'

describe('toIntlLocale', () => {
  it('maps project language codes to BCP-47 tags', () => {
    expect(toIntlLocale('zhCN')).toBe('zh-CN')
    expect(toIntlLocale('zhTW')).toBe('zh-TW')
    expect(toIntlLocale('vi')).toBe('vi-VN')
    expect(toIntlLocale('en')).toBe('en')
  })

  it('accepts compact/accidental variants without throwing', () => {
    expect(toIntlLocale('zhcn')).toBe('zh-CN')
    expect(toIntlLocale('zh-CN')).toBe('zh-CN')
    expect(() => new Intl.DateTimeFormat(toIntlLocale('zhCN'))).not.toThrow()
  })

  it('normalizes interface languages', () => {
    expect(normalizeInterfaceLanguage('vi-VN')).toBe('vi')
    expect(normalizeInterfaceLanguage('vi_VN')).toBe('vi')
    expect(normalizeInterfaceLanguage(null)).toBe('vi')
    expect(normalizeInterfaceLanguage('xx-YY')).toBe('vi')
    expect(normalizeInterfaceLanguage('en')).toBe('en')
  })
})
