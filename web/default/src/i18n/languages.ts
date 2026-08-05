import i18n from 'i18next'

// `short` is the badge shown on the compact language trigger in the header.
// Order is product priority: Vietnamese first, English second (Vietnam-first).
export const INTERFACE_LANGUAGE_OPTIONS = [
  { code: 'vi', label: 'Tiếng Việt', short: 'VI' },
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'zhCN', label: '简体中文', short: '简' },
  { code: 'fr', label: 'Français', short: 'FR' },
  { code: 'ru', label: 'Русский', short: 'RU' },
  { code: 'ja', label: '日本語', short: 'JA' },
  { code: 'zhTW', label: '繁體中文', short: '繁' },
] as const

export type InterfaceLanguageCode =
  (typeof INTERFACE_LANGUAGE_OPTIONS)[number]['code']

export function normalizeInterfaceLanguage(value?: string | null): string {
  if (!value) return 'vi'

  let normalized = value.trim().replaceAll('_', '-').toLowerCase()
  if (
    value === 'zh-TW' ||
    value === 'zh-HK' ||
    value === 'zh-MO' ||
    value === 'zhTW'
  ) {
    normalized = 'zhTW'
  }
  if (value === 'zh-CN' || value === 'zh-Hans' || value === 'zhCN') {
    normalized = 'zhCN'
  }
  if (normalized === 'vi' || normalized.startsWith('vi-')) {
    normalized = 'vi'
  }

  return INTERFACE_LANGUAGE_OPTIONS.some((lang) => lang.code === normalized)
    ? normalized
    : 'vi'
}

/**
 * Map a browser-detected locale onto the interface language codes this project
 * uses with i18next (`zhCN` / `zhTW`).
 *
 * Browsers report standard BCP-47 tags (`zh-CN`, `zh-TW`, `zh-Hant`, `zh`, ...),
 * but `supportedLngs`/resources use the non-standard camelCase codes, so without
 * this mapping a Chinese browser would never match and fall back to English.
 * Non-Chinese codes are returned unchanged so i18next's own `supportedLngs`
 * matching still applies (e.g. `fr-FR` -> `fr`, `ja` -> `ja`).
 */
export function convertDetectedLanguage(value: string): string {
  const lower = value.trim().replaceAll('_', '-').toLowerCase()
  if (!lower.startsWith('zh')) return value
  if (
    lower === 'zh-tw' ||
    lower === 'zh-hk' ||
    lower === 'zh-mo' ||
    lower.startsWith('zh-hant')
  ) {
    return 'zhTW'
  }
  return 'zhCN'
}

/**
 * Convert an interface language code (the values i18next uses, such as `zhCN` /
 * `zhTW`) into a valid BCP-47 locale tag that the `Intl.*` APIs accept.
 *
 * `new Intl.NumberFormat('zhCN')` throws `RangeError: Invalid language tag`, so
 * any locale derived from `i18n.language` / `i18n.resolvedLanguage` MUST be run
 * through this before it reaches an `Intl` constructor. Unknown values fall back
 * to `undefined`, which makes `Intl` use the runtime default locale.
 */
export function toIntlLocale(value?: string | null): string | undefined {
  if (!value) return undefined

  // Project i18n codes are camelCase (`zhCN`/`zhTW`), not BCP-47. Also accept
  // common accidental variants so callers cannot crash DateTimeFormat again.
  const compact = value.trim().replaceAll('_', '-').replaceAll('-', '')
  const lower = compact.toLowerCase()
  if (lower === 'zhcn' || lower === 'zhhans') return 'zh-CN'
  if (
    lower === 'zhtw' ||
    lower === 'zhhant' ||
    lower === 'zhhk' ||
    lower === 'zhmo'
  ) {
    return 'zh-TW'
  }
  if (lower === 'vi' || lower.startsWith('vi')) return 'vi-VN'

  switch (value) {
    case 'zhCN':
      return 'zh-CN'
    case 'zhTW':
      return 'zh-TW'
    case 'vi':
      return 'vi-VN'
    default:
      break
  }
  try {
    return Intl.getCanonicalLocales(value)[0]
  } catch {
    return undefined
  }
}

/** Return the Intl locale for the language currently selected in i18next. */
export function getCurrentIntlLocale(): string | undefined {
  return toIntlLocale(i18n.resolvedLanguage || i18n.language)
}
